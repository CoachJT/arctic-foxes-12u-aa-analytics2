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

test('temporary shared helper preserves zero and excludes missing values from averages', () => {
  const filter = loadStub();
  const rows = [{ shots_for: 0 }, { shots_for: 10 }, { shots_for: null }, {}];
  assert.equal(filter.average(rows, 'shots_for'), 5);
  assert.equal(filter.sum(rows, 'shots_for'), 10);
  assert.equal(filter.recordedCount(rows, 'shots_for'), 2);
  assert.equal(filter.average([{ shots_for: null }], 'shots_for'), null);
  assert.equal(filter.ratio([{ power_play_success: 0, power_play_chances: 0 }], 'power_play_success', 'power_play_chances'), 0);
  assert.equal(filter.ratio([{ power_play_success: 1, power_play_chances: null }], 'power_play_success', 'power_play_chances'), null);
});

test('temporary context selects loaded games without fabricating records', () => {
  const filter = loadStub();
  const context = filter.createContext({
    games: [
      { source_game_id: 'old', date: '2026-09-01' },
      { source_game_id: 'new', date: '2026-09-10' }
    ]
  });
  assert.deepEqual(Array.from(context.selectedGameIds), ['new', 'old']);
  assert.equal(context.mode, 'all-season');
  assert.equal(context.actualCount, 2);
  assert.equal(context.availableCount, 2);
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
