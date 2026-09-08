const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/schedule-management.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/003_team_data_sync.sql', 'utf8');

function loadModule() {
  const context = { window: { crypto: { randomUUID: () => 'generated-uuid' } } };
  vm.runInNewContext(source, context);
  return context.window.FoxesScheduleManagement;
}

function clientFor(rows = []) {
  const calls = [];
  const result = { data: rows[0] || null, error: null };
  const chain = {
    insert: value => { calls.push(['insert', value]); return chain; },
    select: (...args) => { calls.push(['select', args]); return chain; },
    maybeSingle: () => Promise.resolve(result)
  };
  return { client: { from: table => { calls.push(['from', table]); return chain; } }, calls };
}

const workspace = { authorized: true, team_id: 'team-a', season_id: 'season-a' };

test('schedule game validation normalizes safe fields and rejects invalid/missing values', () => {
  const api = loadModule();
  const valid = api.validateScheduleGame({ date: '2026-09-05', opponent: '  Beaver Badgers  ', home_away: 'Away', game_type: 'Tournament', time: '13:30', location: ' Rink 1 ', notes: ' Bring extra jerseys ' });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.game.opponent, 'Beaver Badgers');
  assert.equal(valid.game.location, 'Rink 1');
  const invalid = api.validateScheduleGame({ date: 'not-a-date', opponent: '', home_away: 'Sideways', game_type: 'Made Up', time: '99:99' });
  assert.ok(invalid.errors.length >= 4);
});

test('adding a game to the schedule creates exactly one team-scoped row with a generated source id', async () => {
  const api = loadModule();
  const { client, calls } = clientFor([{ source_schedule_id: 'generated-uuid', date: '2026-09-05', opponent: 'Beaver Badgers' }]);
  const manager = api.createScheduleManagement({ client, getWorkspace: () => workspace });
  await manager.createGame({ date: '2026-09-05', opponent: 'Beaver Badgers', home_away: 'Home', game_type: 'League' });
  const inserts = calls.filter(([method]) => method === 'insert');
  assert.equal(inserts.length, 1, 'exactly one row must be inserted per call');
  const insert = inserts[0][1];
  assert.equal(insert.team_id, 'team-a');
  assert.equal(insert.source_schedule_id, 'generated-uuid');
  assert.equal(insert.opponent, 'Beaver Badgers');
  assert.equal(insert.date, '2026-09-05');
  assert.equal(calls.filter(([method]) => method === 'from' && method !== undefined).length >= 1, true);
  assert.equal(calls.find(([method]) => method === 'from')[1], 'team_schedule_games');
});

test('an invalid payload (missing opponent or date) is rejected before any network write', async () => {
  const api = loadModule();
  const { client, calls } = clientFor();
  const manager = api.createScheduleManagement({ client, getWorkspace: () => workspace });
  await assert.rejects(() => manager.createGame({ date: '', opponent: '' }), /required/i);
  assert.equal(calls.filter(([method]) => method === 'insert').length, 0, 'no insert should be attempted for an invalid payload');
});

test('creating a scheduled game without an authorized team workspace is rejected before any network write', async () => {
  const api = loadModule();
  const { client, calls } = clientFor();
  const manager = api.createScheduleManagement({ client });
  manager.setWorkspace({ authorized: false, team_id: 'team-a' });
  await assert.rejects(() => manager.createGame({ date: '2026-09-05', opponent: 'Beaver Badgers' }), /authorized/);
  assert.equal(calls.filter(([method]) => method === 'insert').length, 0);
});

test('the existing RLS insert policy already permits authenticated schedule.edit writes with no migration needed', () => {
  assert.match(migrationSource, /create policy team_schedule_games_insert/);
  assert.match(migrationSource, /on public\.team_schedule_games for insert/);
  assert.match(migrationSource, /has_team_capability\(team_id, 'schedule\.edit'\)/);
});

test('the web dashboard wires an Add Game control gated by SCHEDULE_EDIT and the schedule entitlement', () => {
  assert.match(appSource, /function canManageSchedule\(\)/);
  assert.match(appSource, /PERMISSIONS\.SCHEDULE_EDIT/);
  assert.match(appSource, /entitlements\.isFeatureEnabled\('schedule'\)/);
  assert.match(appSource, /scheduleManager\.createGame/);
  assert.match(appSource, /await loadPhase1Data\(currentWorkspace\.team_id\);\s*\n\s*scheduleFormOpen = false;/);
  assert.match(indexSource, /schedule-management\.js/);
});

test('the schedule dashboard never performs writes when the coach lacks schedule.edit', () => {
  assert.match(appSource, /const addControl = manage\s*\n\s*\? \(scheduleFormOpen/);
});
