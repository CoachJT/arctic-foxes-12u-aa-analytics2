const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../supabase-sync.js');

const state = {
  seasonKey: '2026-2027',
  players: [
    { id: 'foxes_13', number: '13', name: 'Noah Cain', pos: 'F', active: false, shifts: [] },
    { id: 'foxes_35', number: '35', name: 'Hudson Bouchard', pos: 'G', active: false, shifts: [] }
  ],
  savedGames: [{
    id: 'game-1',
    date: '2026-09-05',
    opponent: 'Ravens',
    periodLengthMin: 15,
    createdAt: 100,
    updatedAt: 200,
    officialStats: {
      imported: true,
      skaters: {
        '13': { playerId: 'foxes_13', number: '13', g: 2, a: 1, shots: 4, plusMinus: 1 }
      },
      goalies: {
        '35': { playerId: 'foxes_35', number: '35', min: 45, saves: 20, ga: 2, w: 1 }
      },
      team: {
        goalsFor: { p1: 1, p2: 1, p3: 0, ot: 0, total: 2 },
        goalsAgainst: { p1: 0, p2: 1, p3: 0, ot: 0, total: 1 },
        shotsFor: { total: 10 },
        shotsAgainst: { total: 22 }
      }
    }
  }]
};

test('maps only Phase 1 records and derives the season record', () => {
  const result = sync.dryRun(state, [{
    id: 'schedule-1',
    date: '2026-09-05',
    time: '10:30',
    opponent: 'Ravens',
    homeAway: 'Home',
    type: 'League',
    location: 'Northstar',
    notes: '',
    linkedGameId: 'game-1',
    createdAt: 10,
    updatedAt: 20
  }], 'team-1');

  assert.deepEqual(result.counts, {
    players: 2,
    scheduleEntries: 1,
    games: 1,
    playerStatRows: 2,
    teamStatRows: 1
  });
  assert.deepEqual(result.seasonRecord, {
    games_played: 1,
    wins: 1,
    losses: 0,
    ties: 0,
    goals_for: 2,
    goals_against: 1
  });
  assert.equal(result.writes, 0);
  assert.equal(result.payload.playerStats[0].team_id, 'team-1');
  assert.ok(!('svPct' in result.payload.playerStats[1]));
});

test('skips invalid rows and never maps excluded tracking or video fields', () => {
  const result = sync.dryRun({
    players: [{ id: 'bad', number: '', name: 'Missing Jersey', pos: 'F' }],
    savedGames: [{
      id: 'game-bad',
      date: '',
      opponent: '',
      players: [{ shifts: [{ startElapsed: 1 }] }],
      filmClips: [{ path: 'private-video.mp4' }],
      officialStats: {}
    }]
  }, [{ id: '', date: '', opponent: '' }], 'team-1');

  assert.equal(result.counts.players, 0);
  assert.equal(result.counts.games, 0);
  assert.equal(result.counts.scheduleEntries, 0);
  assert.equal(result.skipped.length, 3);
  assert.equal(JSON.stringify(result.payload).includes('filmClips'), false);
  assert.equal(JSON.stringify(result.payload).includes('shifts'), false);
});

test('sync uses idempotent upserts and never deletes', async () => {
  const calls = [];
  const client = {
    from(table) {
      return {
        upsert(rows, options) {
          calls.push({ table, rows, options });
          return Promise.resolve({ error: null });
        }
      };
    }
  };
  await sync.sync(client, state, [], 'team-1');
  assert.deepEqual(calls.map(call => [call.table, call.options.onConflict]), [
    ['team_roster_players', 'team_id,source_player_id'],
    ['team_games', 'team_id,source_game_id'],
    ['team_game_player_stats', 'team_id,source_game_id,source_player_id,player_type'],
    ['team_game_team_stats', 'team_id,source_game_id'],
    ['team_season_records', 'team_id,season_key']
  ]);
  assert.equal(calls.some(call => call.table.includes('delete')), false);
});

test('reads the existing schedule localStorage key without changing it', () => {
  let reads = 0;
  const storage = {
    getItem(key) {
      reads += 1;
      assert.equal(key, 'foxes-301-season-schedule');
      return JSON.stringify([{ id: 'schedule-1', date: '2026-09-05', opponent: 'Ravens' }]);
    }
  };
  assert.deepEqual(sync.readSchedule(storage), [
    { id: 'schedule-1', date: '2026-09-05', opponent: 'Ravens' }
  ]);
  assert.equal(reads, 1);
});
