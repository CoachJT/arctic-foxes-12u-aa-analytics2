const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const stubSource = fs.readFileSync('web/stats-filter-context.js', 'utf8');
const analyticsSource = fs.readFileSync('web/analytics-ui.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');

function loadStub() {
  const context = { console, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(stubSource, context);
  return context.FoxesStatsFilter;
}

test('Analytics loads a single shared filter boundary and all seven tabs', () => {
  assert.match(indexSource, /stats-filter-context\.js/);
  assert.match(indexSource, /analytics-ui\.js/);
  assert.match(appSource, /FoxesAnalyticsUI\.render/);
  for (const label of ['Overview', 'Trends', 'Special Teams', 'Periods', 'Players', 'Goalies', 'Games']) {
    assert.match(analyticsSource, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(analyticsSource, /temporaryStub/);
  assert.doesNotMatch(analyticsSource, /supabaseClient\.from/);
});

test('stub exposes exactly the assumed Session B interface shape and no more', () => {
  const filter = loadStub();
  assert.equal(typeof filter.getActiveFilterContext, 'function');
  assert.equal(typeof filter.resolveSelectedGames, 'function');
  assert.equal(typeof filter.getRecordedValue, 'function');
  assert.equal(typeof filter.aggregateField, 'function');
  // Analytics UI must call only through these four functions plus the
  // temporaryStub marker — it must never invent its own selector/aggregate
  // helper names on this module.
  assert.deepEqual(Object.keys(filter).sort(), ['aggregateField', 'getActiveFilterContext', 'getRecordedValue', 'resolveSelectedGames', 'temporaryStub']);
});

test('getRecordedValue preserves explicit zero and treats null/undefined/empty as missing', () => {
  const filter = loadStub();
  assert.deepEqual({ ...filter.getRecordedValue({ shots_for: 0 }, 'shots_for') }, { recorded: true, value: 0 });
  assert.deepEqual({ ...filter.getRecordedValue({ shots_for: 10 }, 'shots_for') }, { recorded: true, value: 10 });
  assert.deepEqual({ ...filter.getRecordedValue({ shots_for: null }, 'shots_for') }, { recorded: false, value: null });
  assert.deepEqual({ ...filter.getRecordedValue({}, 'shots_for') }, { recorded: false, value: null });
});

test('aggregateField excludes missing values from the denominator per spec §2', () => {
  const filter = loadStub();
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

test('resolveSelectedGames dedupes by source_game_id and orders by date descending, ignoring filterContext (all-season only)', () => {
  const filter = loadStub();
  const filterContext = filter.getActiveFilterContext();
  assert.equal(filterContext.mode, 'all-season');
  const games = filter.resolveSelectedGames(filterContext, [
    { source_game_id: 'old', date: '2026-09-01' },
    { source_game_id: 'new', date: '2026-09-10' },
    { source_game_id: 'new', date: '2026-09-10' }
  ]);
  assert.deepEqual(Array.from(games, game => game.source_game_id), ['new', 'old']);
});

test('Analytics renderer remains a browser script without CommonJS assumptions', () => {
  const context = { console, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(stubSource, context);
  vm.runInNewContext(analyticsSource, context);
  assert.deepEqual(Array.from(context.FoxesAnalyticsUI.TABS, tab => tab[0]), ['overview', 'trends', 'special-teams', 'periods', 'players', 'goalies', 'games']);
  const html = context.FoxesAnalyticsUI.render({
    data: {
      games: [{ source_game_id: 'g1', date: '2026-09-10', opponent: 'Rivals' }],
      roster: [],
      teamStats: [{ source_game_id: 'g1', goals_for: 0, goals_against: null }],
      playerStats: []
    }
  });
  assert.match(html, /All Season/);
  assert.match(html, />0\.0</);
  assert.match(html, /—/);
});
