const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/roster-management.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/011_roster_management.sql', 'utf8');

function loadModule() {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.FoxesRosterManagement;
}

function clientFor(rows = []) {
  const calls = [];
  const result = { data: rows[0] || null, error: null };
  const chain = {
    insert: value => { calls.push(['insert', value]); return chain; },
    update: value => { calls.push(['update', value]); return chain; },
    eq: (...args) => { calls.push(['eq', args]); return chain; },
    select: (...args) => { calls.push(['select', args]); return chain; },
    maybeSingle: () => Promise.resolve(result)
  };
  return { client: { from: table => { calls.push(['from', table]); return chain; } }, calls };
}

const workspace = { authorized: true, organization_id: 'org-a', team_id: 'team-a', season_id: 'season-a' };

test('player validation normalizes safe fields and rejects invalid combinations', () => {
  const api = loadModule();
  const valid = api.validatePlayer({ jersey_number: ' 73 ', first_name: 'Landon ', last_name: 'Kowalski', position: 'f', player_type: 'skater', shoots: '', status: 'active' });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.player.jersey_number, '73');
  assert.equal(valid.player.position, 'F');
  assert.equal(valid.player.shoots, 'unknown');
  const invalid = api.validatePlayer({ jersey_number: '1000', first_name: 'New', last_name: 'Goalie', position: 'F', player_type: 'goalie', shoots: 'X' });
  assert.ok(invalid.errors.length >= 3);
});

test('player creation derives team and season from the authorized workspace', async () => {
  const api = loadModule();
  const { client, calls } = clientFor([{ id: 'player-1', team_id: 'team-a' }]);
  const manager = api.createRosterManagement({ client, getWorkspace: () => workspace });
  await manager.createPlayer({ jersey_number: '12', first_name: 'New', last_name: 'Player', position: 'F', player_type: 'skater', shoots: 'R' });
  const insert = calls.find(([method]) => method === 'insert')[1];
  assert.equal(insert.team_id, 'team-a');
  assert.equal(insert.season_id, 'season-a');
  assert.equal(Object.hasOwn(insert, 'created_by'), false);
});

test('edit and lifecycle operations always scope updates to the selected team', async () => {
  const api = loadModule();
  const { client, calls } = clientFor([{ id: 'player-1', status: 'inactive' }]);
  const manager = api.createRosterManagement({ client });
  manager.setWorkspace(workspace);
  await manager.updatePlayer('player-1', { jersey_number: '12', first_name: 'New', last_name: 'Player', position: 'F', player_type: 'skater', shoots: 'R' });
  await manager.deactivatePlayer('player-1');
  assert.ok(calls.some(([method, args]) => method === 'eq' && args[0] === 'team_id' && args[1] === 'team-a'));
  manager.setWorkspace({ authorized: false, team_id: 'other-team' });
  await assert.rejects(() => manager.createPlayer({ jersey_number: '1', first_name: 'Blocked', last_name: 'Player', position: 'F', player_type: 'skater' }), /authorized/);
});

test('CSV imports validate invalid rows and flag likely duplicates', () => {
  const api = loadModule();
  const manager = api.createRosterManagement({ client: clientFor().client, getWorkspace: () => workspace });
  const rows = manager.parseCsv('jersey_number,first_name,last_name,position,player_type,shoots,notes,status\n73,Landon,Kowalski,F,skater,R,,active\nbad,,Missing,G,goalie,X,,active');
  const result = manager.validateImport(rows, [{ first_name: 'Landon', last_name: 'Kowalski', jersey_number: '73' }]);
  assert.equal(result.valid.length, 0);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.errors.length, 1);
});

test('Stage F migration preserves historical rows, blocks team moves, and enforces capability plus entitlement', () => {
  assert.match(migrationSource, /add column if not exists season_id/);
  assert.match(migrationSource, /first_name text not null/);
  assert.match(migrationSource, /status in \('active', 'inactive'\)/);
  assert.match(migrationSource, /A roster player cannot be moved between teams/);
  assert.match(migrationSource, /has_workspace_feature_access\(team_id, 'players\.evaluate', 'players'\)/);
  assert.match(migrationSource, /revoke delete on public\.team_roster_players/);
});

test('Stage F app exposes empty-roster controls and clears roster workspace state', () => {
  assert.match(appSource, /No players yet/);
  assert.match(appSource, /Add players one at a time or import your roster/);
  assert.match(appSource, /Download Template/);
  assert.match(appSource, /rosterManager\.clearWorkspace/);
  assert.match(appSource, /rosterManager\.setWorkspace/);
  assert.match(appSource, /team_roster_players/);
});
