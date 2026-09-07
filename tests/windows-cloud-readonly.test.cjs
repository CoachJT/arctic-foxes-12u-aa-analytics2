'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cloud = require('../windows-cloud-readonly');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

function mockClient({ memberships, seasons, permissions, datasets }) {
  const calls = [];
  const auth = {
    session: { user: { id: 'user-1', email: 'owner@example.com' } },
    async getSession() { return { data: { session: this.session } }; },
    async signInWithPassword() { return { data: { session: this.session }, error: null }; },
    async signOut() { this.session = null; return { error: null }; }
  };
  return {
    calls,
    auth,
    from(table) {
      const filters = [];
      const chain = {
        select(fields) { calls.push([table, 'select', fields]); return chain; },
        eq(field, value) { filters.push([field, value]); calls.push([table, 'eq', field, value]); return chain; },
        order(field) { calls.push([table, 'order', field]); return chain; },
        then(resolve, reject) {
          const team = filters.find(item => item[0] === 'team_id')?.[1];
          let data = table === 'team_memberships' ? memberships
            : table === 'seasons' ? seasons.filter(row => !team || row.team_id === team)
              : table === 'role_permissions' ? permissions
                : datasets[table] || [];
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return chain;
    }
  };
}

const membership = {
  team_id: 'team-1', role_id: 'owner', status: 'active',
  teams: { id: 'team-1', name: 'Foxes', slug: 'arctic-foxes-12u-aa', default_season_id: 'season-1' },
  roles: { label: 'Owner' }
};

const datasets = {
  team_roster_players: [{ team_id: 'team-1', source_player_id: 'p-1', jersey_number: '13', name: 'Cloud Name', position: 'F' }],
  team_schedule_games: [{ team_id: 'team-1', source_schedule_id: 'schedule-1', date: '2026-09-02', opponent: 'Bears' }],
  team_games: [{ team_id: 'team-1', source_game_id: 'game-1', date: '2026-09-02', opponent: 'Bears' }],
  team_game_player_stats: [{ team_id: 'team-1', source_game_id: 'game-1', source_player_id: 'p-1', player_type: 'skater', goals: 2 }],
  team_game_team_stats: [{ team_id: 'team-1', source_game_id: 'game-1', goals_for: 2, goals_against: 1 }],
  team_season_records: [{ team_id: 'team-1', season_key: '2026-2027', wins: 1 }],
  phase2_opponent_profiles: [{ team_id: 'team-1', source_profile_key: 'opponent:r', opponent_name: 'Ravens' }],
  phase2_opponent_players: [{ team_id: 'team-1', source_player_key: 'opp:7', source_game_id: 'game-1', opponent_profile_key: 'opponent:r', jersey_number: '7', player_name: 'Opponent Seven', position: 'F' }]
};

test('auth loads memberships, remembered team/season, and RLS-backed capabilities', async () => {
  const client = mockClient({
    memberships: [membership],
    seasons: [{ id: 'season-1', team_id: 'team-1', name: '2026–2027', season_key: '2026-2027', status: 'active' }],
    permissions: [{ capability: 'players.view' }, { capability: 'stats.view' }],
    datasets
  });
  const manager = cloud.createWindowsCloudReadonly({ client, storage: storage() });
  await manager.loadContext();
  assert.equal(manager.context.selectedMembership.team_id, 'team-1');
  assert.equal(manager.context.selectedSeason.season_key, '2026-2027');
  assert.deepEqual(manager.context.capabilities, ['players.view', 'stats.view']);
  assert.ok(client.calls.some(call => call[0] === 'team_memberships' && call[1] === 'eq' && call[2] === 'status' && call[3] === 'active'));
  assert.ok(client.calls.some(call => call[0] === 'seasons' && call[1] === 'eq' && call[2] === 'team_id' && call[3] === 'team-1'));
}
);

test('read-only bootstrap scopes reads by team and selected season', async () => {
  const client = mockClient({
    memberships: [membership],
    seasons: [{ id: 'season-1', team_id: 'team-1', name: 'Active', season_key: '2026-2027', status: 'active', starts_on: '2026-09-01', ends_on: '2027-04-30' }],
    permissions: [{ capability: 'dashboard.view' }],
    datasets: {
      ...datasets,
      team_games: [...datasets.team_games, { team_id: 'team-1', source_game_id: 'old', date: '2025-01-01', opponent: 'Old' }]
    }
  });
  const manager = cloud.createWindowsCloudReadonly({ client, storage: storage() });
  await manager.loadContext();
  const pending = await manager.prepareBootstrap({
    state: {
      seasonKey: 'local-old',
      players: [{ id: 'p-1', number: '13', name: 'Local Name', pos: 'F', shifts: [{ startElapsed: 1 }], customMetadata: { keep: true } }],
      savedGames: [{ id: 'game-1', date: '2026-09-02', opponent: 'Bears', filmClips: [{ path: 'C:\\film\\clip.mp4' }], events: [{ type: 'shot' }] }]
    },
    schedule: []
  });
  assert.equal(pending.result.state.players[0].name, 'Cloud Name');
  assert.deepEqual(pending.result.state.players[0].shifts, [{ startElapsed: 1 }]);
  assert.deepEqual(pending.result.state.savedGames[0].filmClips, [{ path: 'C:\\film\\clip.mp4' }]);
  assert.equal(pending.result.state.seasonRecord.season_key, '2026-2027');
  assert.equal(pending.result.state.savedGames.some(game => game.id === 'old'), false);
  assert.ok(client.calls.filter(call => call[1] === 'eq').some(call => call[0] === 'team_games' && call[2] === 'team_id' && call[3] === 'team-1'));
  assert.equal(pending.result.writes, 0);
  assert.equal(pending.result.deletes, 0);
});

test('diagnostic reports counts and source-ID mismatches', () => {
  const diagnostic = cloud.diagnosticReport({
    state: { players: [{ id: 'local-only', number: '4', name: 'Local', pos: 'D' }], savedGames: [] },
    schedule: [],
    datasets: { roster: [{ source_player_id: 'cloud-only' }] }
  });
  assert.deepEqual(diagnostic.counts.roster, { cloud: 1, local: 1, shared: 0, cloudOnly: 1, localOnly: 1 });
  assert.equal(diagnostic.mismatches[0].dataset, 'roster');
  assert.equal(diagnostic.hasMismatch, true);
});

test('confirmation gates materialization and keeps transition write-free', async () => {
  const client = mockClient({
    memberships: [membership],
    seasons: [{ id: 'season-1', team_id: 'team-1', name: 'Active', season_key: '2026-2027', status: 'active' }],
    permissions: [],
    datasets
  });
  const manager = cloud.createWindowsCloudReadonly({ client, storage: storage() });
  await manager.loadContext();
  await manager.prepareBootstrap({ state: { players: [], savedGames: [] }, schedule: [] });
  assert.throws(() => manager.confirmBootstrap(false), /Explicit confirmation/);
  const approved = manager.confirmBootstrap(true);
  assert.equal(approved.result.writes, 0);
  assert.equal(approved.result.deletes, 0);
  assert.throws(() => manager.confirmBootstrap(true), /Run the read-only/);
  assert.equal(manager.primary.queue.list().length, 0);
});

test('publishable key is used and service-role credentials are absent from the Windows path', () => {
  const source = fs.readFileSync('windows-cloud-readonly.js', 'utf8');
  assert.match(source, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(source, /service[_-]?role/i);
  assert.doesNotMatch(source, /\.upsert\(|\.insert\(|\.delete\(/);
});

test('Windows UI exposes explicit diagnostic confirmation and does not flush or write cloud data', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const start = html.indexOf('// Authenticated cloud bootstrap is always manual.');
  const integration = html.slice(start);
  assert.match(html, /Load from PuckNexus \(Read Only\)/);
  assert.match(html, /cloudConfirm/);
  assert.match(html, /cloudApplyButton/);
  assert.doesNotMatch(integration, /controller\.primary\.flush\(/);
  assert.doesNotMatch(integration, /\.upsert\(|\.insert\(|\.update\(|\.delete\(/);
});
