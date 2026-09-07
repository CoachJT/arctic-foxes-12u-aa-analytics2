'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cloud = require('../cloud-primary-transition');

function clientFor(data, calls) {
  return {
    from(table) {
      const chain = {
        select(fields) { calls.push([table, 'select', fields]); return chain; },
        eq(field, value) {
          calls.push([table, 'eq', field, value]);
          return Promise.resolve({ data: data[table] || [], error: null });
        }
      };
      return chain;
    }
  };
}

const baseState = {
  seasonKey: '2026-2027',
  players: [{
    id: 'foxes_13', number: '13', name: 'Local Name', pos: 'F',
    shifts: [{ startElapsed: 1, endElapsed: 2 }], customMetadata: { keep: true }
  }],
  savedGames: [{
    id: 'game-1', date: '2026-09-01', opponent: 'Ravens',
    filmClips: [{ path: 'C:\\film\\private.mp4' }],
    events: [{ type: 'shot', playerId: 'foxes_13' }],
    players: [{ id: 'foxes_13', shifts: [{ startElapsed: 3 }] }],
    officialStats: { skaters: { '13': { playerId: 'foxes_13', g: 1 } } }
  }]
};

test('cloud-primary bootstrap is read-only, team-scoped, and materializes the Windows shape', async () => {
  const calls = [];
  const client = clientFor({
    team_roster_players: [{ team_id: 'team-1', source_player_id: 'foxes_13', jersey_number: '13', name: 'Cloud Name', position: 'F' }],
    team_schedule_games: [{ team_id: 'team-1', source_schedule_id: 'schedule-1', date: '2026-09-02', opponent: 'Bears' }],
    team_games: [{ team_id: 'team-1', source_game_id: 'game-1', date: '2026-09-01', opponent: 'Ravens', period_length_min: 15 }],
    team_game_player_stats: [{ team_id: 'team-1', source_game_id: 'game-1', source_player_id: 'foxes_13', player_type: 'skater', goals: 2 }],
    team_game_team_stats: [{ team_id: 'team-1', source_game_id: 'game-1', goals_for: 2, goals_against: 1 }],
    team_season_records: [{ team_id: 'team-1', season_key: '2026-2027', wins: 1, losses: 0, ties: 0 }],
    phase2_opponent_profiles: [{ team_id: 'team-1', source_profile_key: 'opponent:r', opponent_name: 'Ravens' }],
    phase2_opponent_players: [{ team_id: 'team-1', source_player_key: 'player:opp-7', source_game_id: 'game-1', opponent_profile_key: 'opponent:r', jersey_number: '7', player_name: 'Opponent Seven', position: 'F' }]
  }, calls);
  const primary = cloud.createCloudPrimary({
    mode: 'read-only', client, storage: cloud.memoryStorage()
  });
  const result = await primary.bootstrap({ teamId: 'team-1', state: baseState, schedule: [] });
  assert.equal(result.writes, 0);
  assert.equal(result.deletes, 0);
  assert.equal(result.state.players[0].name, 'Cloud Name');
  assert.deepEqual(result.state.players[0].shifts, baseState.players[0].shifts);
  assert.deepEqual(result.state.players[0].customMetadata, { keep: true });
  assert.deepEqual(result.state.savedGames[0].filmClips, baseState.savedGames[0].filmClips);
  assert.deepEqual(result.state.savedGames[0].events, baseState.savedGames[0].events);
  assert.equal(result.state.savedGames[0].officialStats.skaters['13'].g, 2);
  assert.equal(result.schedule[0].opponent, 'Bears');
  assert.equal(result.state.command31, undefined);
  assert.equal(result.state.opponentPlayers.length, 1);
  assert.ok(calls.every(call => call[1] === 'select' || (call[1] === 'eq' && call[2] === 'team_id' && call[3] === 'team-1')));
  assert.equal(calls.some(call => call[1] === 'upsert' || call[1] === 'delete'), false);
});

test('dry-run and local modes use cache only and cache materialization never deletes local records', async () => {
  const storage = cloud.memoryStorage();
  const cache = cloud.createCloudCache({ storage });
  cache.set('roster', 'team-1', [{ source_player_id: 'cloud-only', jersey_number: '99', name: 'Cloud Only', position: 'F' }]);
  const primary = cloud.createCloudPrimary({ mode: 'dry-run', client: {
    from() { throw new Error('network must not be used'); }
  }, cache, storage });
  const result = await primary.bootstrap({
    teamId: 'team-1',
    state: { players: [{ id: 'local-only', number: '4', name: 'Keep Me', pos: 'D', notes: 'local' }], savedGames: [] },
    schedule: [{ id: 'local-schedule', date: '2026-09-01', opponent: 'Local' }]
  });
  assert.equal(result.state.players.length, 2);
  assert.equal(result.state.players[0].notes, 'local');
  assert.equal(result.schedule.length, 1);
  assert.equal(result.schedule[0].id, 'local-schedule');
});

test('queue persists, retries with exponential backoff, and completes without cloud writes', async () => {
  const storage = cloud.memoryStorage();
  let now = 1000;
  const first = cloud.createSyncQueue({ storage, clock: () => now, retryBaseMs: 100, maxRetries: 3 });
  first.enqueue({ teamId: 'team-1', dataset: 'roster', sourceId: 'p1', payload: { team_id: 'team-1', source_player_id: 'p1' } });
  const second = cloud.createSyncQueue({ storage, clock: () => now, retryBaseMs: 100, maxRetries: 3 });
  assert.equal(second.list().length, 1);
  const executor = async () => { throw new Error('offline'); };
  let summary = await second.process({ executor, now });
  assert.deepEqual(summary, { attempted: 1, completed: 0, retried: 1, conflicts: 0, failed: 0, skipped: 0 });
  assert.equal(second.list()[0].nextAttemptAt, 1100);
  summary = await second.process({ executor, now: 1099 });
  assert.equal(summary.skipped, 1);
  now = 1100;
  await second.process({ executor, now });
  assert.equal(second.list()[0].nextAttemptAt, 1300);
});

test('queue marks revision conflicts and rejects cross-team payloads', async () => {
  const queue = cloud.createSyncQueue({ storage: cloud.memoryStorage(), retryBaseMs: 1 });
  assert.throws(() => queue.enqueue({
    teamId: 'team-a', dataset: 'games', sourceId: 'g1',
    payload: { team_id: 'team-b', source_game_id: 'g1' }
  }), /Cross-team/);
  queue.enqueue({
    teamId: 'team-a', dataset: 'games', sourceId: 'g1',
    baseRevision: 'old', payload: { team_id: 'team-a', source_game_id: 'g1' }
  });
  const summary = await queue.process({
    now: 0,
    conflictDetector: item => queue.detectConflict(item, 'new') ? { reason: 'changed remotely' } : null,
    executor: async () => { throw new Error('must not execute conflicted item'); }
  });
  assert.equal(summary.conflicts, 1);
  assert.equal(queue.list()[0].status, 'conflict');
});

test('local sync queue mapping keeps team scope and never enables live writes by default', async () => {
  const primary = cloud.createCloudPrimary({ mode: 'local', storage: cloud.memoryStorage() });
  const result = primary.enqueueMapped({
    roster: [{ team_id: 'team-1', source_player_id: 'p1' }],
    schedule: [], games: [], playerStats: [], teamStats: [],
    seasonRecord: { season_key: '2026-2027', wins: 0 }
  }, 'team-1');
  assert.equal(result.writes, 0);
  assert.equal(result.queued, 2);
  assert.deepEqual(await primary.flush(), {
    mode: 'local', writes: 0, disabled: true, reason: 'live writes are disabled'
  });
});

test('local sync mapper reuses stable source IDs and remains dry-run only', () => {
  const primary = cloud.createCloudPrimary({ mode: 'local', storage: cloud.memoryStorage() });
  const result = primary.enqueueLocalSync({
    teamId: 'team-1',
    state: {
      seasonKey: '2026-2027',
      players: [{ id: 'p1', number: '13', name: 'Player', pos: 'F' }],
      savedGames: []
    },
    schedule: []
  });
  assert.equal(result.dryRun.writes, 0);
  assert.equal(result.queued, 2);
  const rosterItem = result.items.find(item => item.dataset === 'roster');
  assert.equal(rosterItem.sourceId, 'p1');
  assert.equal(primary.queue.list().find(item => item.dataset === 'roster').payload.source_player_id, 'p1');
});
