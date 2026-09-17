const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Integration note (parent session): web/stats-filter-context.js was
// Session C's temporarily-marked stub during independent development. It
// has since been replaced by a real adapter wiring Session C's Analytics
// UI to Session B's real shared filter engine (web/stats-filter-engine.js)
// and the shared active filter context instance created in web/app.js,
// per the parent integration plan. This test file has been updated to
// match: it now loads the real engine alongside the adapter and asserts
// real (not fixed "all-season") filter behavior.
const engineSource = fs.readFileSync('web/stats-filter-engine.js', 'utf8');
const adapterSource = fs.readFileSync('web/stats-filter-context.js', 'utf8');
const analyticsSource = fs.readFileSync('web/analytics-ui.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');

function loadAdapter(sharedContextOverrides = {}) {
  const context = { console, globalThis: {}, window: undefined };
  context.globalThis = context;
  vm.runInNewContext(engineSource, context);
  const games = sharedContextOverrides.games || [];
  const schedule = sharedContextOverrides.schedule || [];
  context.FoxesFilterContext = context.FoxesStatsFilterEngine.createFilterContext({
    getGames: () => games,
    getScheduleGames: () => schedule
  });
  if (sharedContextOverrides.mode) {
    context.FoxesFilterContext.setMode(sharedContextOverrides.mode, sharedContextOverrides.params || {});
  }
  vm.runInNewContext(adapterSource, context);
  return context.FoxesStatsFilter;
}

test('Analytics loads a single shared filter boundary and all seven tabs', () => {
  assert.match(indexSource, /stats-filter-engine\.js/);
  assert.match(indexSource, /stats-filter-context\.js/);
  assert.match(indexSource, /analytics-ui\.js/);
  assert.match(appSource, /FoxesAnalyticsUI\.render/);
  for (const label of ['Overview', 'Trends', 'Special Teams', 'Periods', 'Players', 'Goalies', 'Games']) {
    assert.match(analyticsSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(analyticsSource, /temporaryStub/);
  assert.doesNotMatch(analyticsSource, /supabaseClient\.from/);
});

test('adapter exposes exactly the assumed Session B interface shape and no more', () => {
  const filter = loadAdapter();
  assert.equal(typeof filter.getActiveFilterContext, 'function');
  assert.equal(typeof filter.resolveSelectedGames, 'function');
  assert.equal(typeof filter.getRecordedValue, 'function');
  assert.equal(typeof filter.aggregateField, 'function');
  // Analytics UI must call only through these four functions plus the
  // temporaryStub marker — it must never invent its own selector/aggregate
  // helper names on this module.
  assert.deepEqual(Object.keys(filter).sort(), ['aggregateField', 'getActiveFilterContext', 'getRecordedValue', 'resolveSelectedGames', 'temporaryStub']);
  // The real adapter is no longer a temporary stub.
  assert.equal(filter.temporaryStub, false);
});

test('getRecordedValue preserves explicit zero and treats null/undefined/empty as missing', () => {
  const filter = loadAdapter();
  assert.deepEqual({ ...filter.getRecordedValue({ shots_for: 0 }, 'shots_for') }, { recorded: true, value: 0 });
  assert.deepEqual({ ...filter.getRecordedValue({ shots_for: 10 }, 'shots_for') }, { recorded: true, value: 10 });
  assert.deepEqual({ ...filter.getRecordedValue({ shots_for: null }, 'shots_for') }, { recorded: false, value: null });
  assert.deepEqual({ ...filter.getRecordedValue({}, 'shots_for') }, { recorded: false, value: null });
});

test('aggregateField excludes missing values from the denominator per spec §2', () => {
  const filter = loadAdapter();
  const rows = [{ shots_for: 0 }, { shots_for: 10 }, { shots_for: null }, {}];
  assert.deepEqual({ ...filter.aggregateField(rows, 'shots_for') }, { sum: 10, count: 2, average: 5 });
  assert.deepEqual({ ...filter.aggregateField([{ shots_for: null }], 'shots_for') }, { sum: null, count: 0, average: null });
  // 10 selected rows, 4 recorded -> denominator is 4, never 10 (binding example from spec §2).
  const tenRows = [...Array(6).fill({}), { shots_for: 1 }, { shots_for: 1 }, { shots_for: 1 }, { shots_for: 1 }];
  const result = filter.aggregateField(tenRows, 'shots_for');
  assert.equal(tenRows.length, 10);
  assert.equal(result.count, 4);
  assert.equal(result.average, 1);
});

test('getActiveFilterContext/resolveSelectedGames delegate to Session B\'s real shared engine, not a fixed all-season stub', () => {
  const games = [
    { source_game_id: 'old', date: '2026-09-01' },
    { source_game_id: 'new', date: '2026-09-10' }
  ];
  const filter = loadAdapter({ games, mode: 'last5' });
  const filterContext = filter.getActiveFilterContext();
  assert.equal(filterContext.mode, 'last5');
  const resolved = filter.resolveSelectedGames(filterContext, games);
  // Real engine orders most-recent-first.
  assert.deepEqual(Array.from(resolved, game => game.source_game_id), ['new', 'old']);
});

test('getActiveFilterContext throws loudly if the shared context/engine were not wired, instead of silently reverting to a fixed fallback', () => {
  const context = { console, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(adapterSource, context);
  assert.throws(() => context.FoxesStatsFilter.getActiveFilterContext(), /FoxesFilterContext/);
});

test('Analytics renderer remains a browser script without CommonJS assumptions', () => {
  const games = [{ source_game_id: 'g1', date: '2026-09-10', opponent: 'Rivals' }];
  const context = { console, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(engineSource, context);
  context.FoxesFilterContext = context.FoxesStatsFilterEngine.createFilterContext({
    getGames: () => games,
    getScheduleGames: () => []
  });
  vm.runInNewContext(adapterSource, context);
  vm.runInNewContext(analyticsSource, context);
  assert.deepEqual(Array.from(context.FoxesAnalyticsUI.TABS, tab => tab[0]), ['overview', 'trends', 'special-teams', 'periods', 'players', 'goalies', 'games']);
  const html = context.FoxesAnalyticsUI.render({
    data: {
      games,
      roster: [],
      teamStats: [{ source_game_id: 'g1', goals_for: 0, goals_against: null }],
      playerStats: []
    }
  });
  assert.match(html, /0\.0/);
  assert.match(html, /—/);
});

