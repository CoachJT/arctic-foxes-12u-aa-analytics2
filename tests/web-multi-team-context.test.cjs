const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const teamSource = fs.readFileSync('web/team-context.js', 'utf8');
const seasonSource = fs.readFileSync('web/season-context.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/006_multi_team_foundation.sql', 'utf8');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function query(result, onCall) {
  const chain = {
    select: (...args) => { onCall?.('select', args); return chain; },
    eq: (...args) => { onCall?.('eq', args); return chain; },
    order: (...args) => { onCall?.('order', args); return chain; },
    maybeSingle: (...args) => { onCall?.('maybeSingle', args); return Promise.resolve(result); },
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return chain;
}

function loadModule(source, globals = {}) {
  const context = {
    window: {
      sessionStorage: storage(),
      document: { documentElement: { style: { setProperty() {} } } },
      ...globals
    }
  };
  vm.runInNewContext(source, context);
  return context.window;
}

test('team context supports multiple memberships with independent roles', async () => {
  const calls = [];
  const memberships = [
    { team_id: 'team-a', role_id: 'owner', status: 'active', teams: { id: 'team-a', name: 'Team A', slug: 'team-a' }, roles: { label: 'Owner' } },
    { team_id: 'team-b', role_id: 'assistant', status: 'active', teams: { id: 'team-b', name: 'Team B', slug: 'team-b' }, roles: { label: 'Assistant' } }
  ];
  const client = { from: table => query({ data: memberships, error: null }, (method, args) => calls.push([table, method, args])) };
  const win = loadModule(teamSource);
  const manager = win.FoxesTeamContext.createTeamContext({ client, storage: storage() });
  await manager.load('user-1');
  assert.equal(manager.context.selectedTeamId, 'team-a');
  assert.equal(manager.context.selectedMembership.role_id, 'owner');
  manager.select('team-b');
  assert.equal(manager.context.selectedTeamId, 'team-b');
  assert.equal(manager.context.selectedMembership.role_id, 'assistant');
  assert.ok(calls.some(([table, method, args]) => table === 'team_memberships' && method === 'eq' && args[0] === 'status' && args[1] === 'active'));
});

test('season context scopes seasons and supports switching with branding fallback', async () => {
  const calls = [];
  const seasons = [
    { id: 'season-active', team_id: 'team-a', name: '2026–2027 Season', season_key: '2026-2027', status: 'active' },
    { id: 'season-old', team_id: 'team-a', name: '2025–2026 Season', season_key: '2025-2026', status: 'archived' }
  ];
  const client = {
    from: table => query(
      table === 'seasons'
        ? { data: seasons, error: null }
        : { data: null, error: null },
      (method, args) => calls.push([table, method, args])
    )
  };
  const win = loadModule(seasonSource);
  const manager = win.FoxesSeasonContext.createSeasonContext({ client, storage: storage() });
  await manager.load('team-a', 'season-active');
  assert.equal(manager.context.selectedSeasonId, 'season-active');
  manager.select('season-old');
  assert.equal(manager.context.selectedSeason.season_key, '2025-2026');
  assert.equal(manager.context.branding.primary_color, '#d71920');
  assert.ok(calls.some(([table, method, args]) => table === 'seasons' && method === 'eq' && args[0] === 'team_id' && args[1] === 'team-a'));
  assert.throws(() => manager.select('season-other'), /does not belong/);
});

test('web context clears team data before reloading and loads seasons/branding through the selected team', () => {
  assert.match(appSource, /phase1Data = null/);
  assert.match(appSource, /phase2AData = null/);
  assert.match(appSource, /seasonContextManager\.load\(membership\.team_id/);
  assert.match(appSource, /FoxesTeamContext\.createTeamContext/);
  assert.match(appSource, /FoxesSeasonContext\.createSeasonContext/);
  assert.match(appSource, /\.eq\('team_id', teamId\)/);
});

test('web shell includes extracted context modules and switcher hosts', () => {
  assert.match(indexSource, /id="teamSwitcher"/);
  assert.match(indexSource, /id="seasonSwitcher"/);
  assert.match(indexSource, /team-context\.js\?v=multi-team-1/);
  assert.match(indexSource, /season-context\.js\?v=multi-team-1/);
});

test('branding is structured and does not permit arbitrary CSS injection', () => {
  assert.match(seasonSource, /primary_color/);
  assert.match(seasonSource, /secondary_color/);
  assert.match(seasonSource, /accent_color/);
  assert.doesNotMatch(seasonSource, /innerHTML\s*=\s*.*branding/);
  assert.doesNotMatch(seasonSource, /custom_css/);
});

test('multi-team migration is additive and backfills Arctic Foxes foundation rows', () => {
  for (const table of ['organizations', 'organization_memberships', 'seasons', 'team_branding']) {
    assert.match(migrationSource, new RegExp(`create table public\\.${table}`));
  }
  assert.match(migrationSource, /alter table public\.teams[\s\S]*organization_id uuid/);
  assert.match(migrationSource, /default_season_id uuid/);
  assert.match(migrationSource, /slug = 'arctic-foxes-12u-aa'/);
  assert.match(migrationSource, /'2026-2027'/);
  assert.match(migrationSource, /'Arctic Foxes 12U AA'/);
  assert.doesNotMatch(migrationSource, /\bdelete from\b/i);
  assert.doesNotMatch(migrationSource, /\bdrop table\b/i);
});
