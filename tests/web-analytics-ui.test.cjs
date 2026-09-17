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
const stylesSource = fs.readFileSync('web/styles.css', 'utf8');

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

// --- Blocker regression coverage below (built directly on the shared engine) ---

function loadAnalytics(games, schedule = []) {
  const context = { console, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(engineSource, context);
  context.FoxesFilterContext = context.FoxesStatsFilterEngine.createFilterContext({
    getGames: () => games,
    getScheduleGames: () => schedule
  });
  vm.runInNewContext(adapterSource, context);
  vm.runInNewContext(analyticsSource, context);
  return context.FoxesAnalyticsUI;
}

const bGames = [
  { source_game_id: 'g1', date: '2026-09-01', opponent: 'Alpha' },
  { source_game_id: 'g2', date: '2026-09-03', opponent: 'Beta' },
  { source_game_id: 'g3', date: '2026-09-05', opponent: 'Gamma' }
];
const bTeamStats = [
  { source_game_id: 'g1', goals_for: 3, goals_against: 1, shots_for: 20, shots_against: 15, power_play_success: 1, power_play_chances: 4, penalty_kill_success: 2, penalty_kill_chances: 2, goals_for_p1: 1, goals_for_p2: 1, goals_for_p3: 1, goals_against_p1: 1, goals_against_p2: 0, goals_against_p3: 0 },
  { source_game_id: 'g2', goals_for: 1, goals_against: 4, shots_for: 18, shots_against: 22 },
  { source_game_id: 'g3', goals_for: 0, goals_against: 0, shots_for: 10, shots_against: 10 }
];

test('Blocker 1: Overview shows Record, GF/G, GA/G, SF/G, SA/G, and differentials with sample-size context, never dividing by every selected game', () => {
  const analytics = loadAnalytics(bGames);
  const html = analytics.render({ data: { games: bGames, roster: [], teamStats: bTeamStats, playerStats: [] }, tab: 'overview' });
  assert.match(html, /Record/);
  assert.match(html, /1-1-1/); // g1 W, g2 L, g3 T
  assert.match(html, /3 of 3 games recorded/);
  assert.match(html, /Goal differential/);
  assert.match(html, /Shot differential/);
  assert.match(html, /GF\/G/);
  assert.match(html, /GA\/G/);
  assert.match(html, /SF\/G/);
  assert.match(html, /SA\/G/);
});

test('Blocker 1: Overview record only counts games with a recorded goals_for/goals_against pair, and shows sample context instead of a fabricated average', () => {
  const partialGames = [{ source_game_id: 'g1', date: '2026-09-01' }, { source_game_id: 'g2', date: '2026-09-03' }];
  const partialStats = [{ source_game_id: 'g1', goals_for: 2, goals_against: 1 }]; // g2 has no team stats row at all
  const analytics = loadAnalytics(partialGames);
  const html = analytics.render({ data: { games: partialGames, roster: [], teamStats: partialStats, playerStats: [] }, tab: 'overview' });
  assert.match(html, /1 of 2 games recorded/);
});

test('Blocker 1: Trends renders GF vs GA / SF vs SA charts, recent form, and PP/PK trend charts without inventing values', () => {
  const analytics = loadAnalytics(bGames);
  const html = analytics.render({ data: { games: bGames, roster: [], teamStats: bTeamStats, playerStats: [] }, tab: 'trends' });
  assert.match(html, /Goals for vs\. against/);
  assert.match(html, /Shots for vs\. against/);
  assert.match(html, /Recent form/);
  assert.match(html, /Power-play trend/);
  assert.match(html, /Penalty-kill trend/);
  assert.match(html, /analytics-bar-chart/);
  assert.match(html, /bar-missing/); // g2/g3 have no recorded PP/PK data
});

test('Blocker 1: Special Teams surfaces PP%, PK%, opportunities, and times shorthanded from real recorded fields only', () => {
  const analytics = loadAnalytics(bGames);
  const html = analytics.render({ data: { games: bGames, roster: [], teamStats: bTeamStats, playerStats: [] }, tab: 'special-teams' });
  assert.match(html, /Power-play %/);
  assert.match(html, /Penalty-kill %/);
  assert.match(html, /PP opportunities/);
  assert.match(html, /Times shorthanded/);
  assert.doesNotMatch(html, /PPGA|SHGA/);
});

test('Blocker 1: Periods shows GF/GA/SF/SA by period plus differentials, and missing period data never renders as a zero bar', () => {
  const analytics = loadAnalytics(bGames);
  const html = analytics.render({ data: { games: bGames, roster: [], teamStats: bTeamStats, playerStats: [] }, tab: 'periods' });
  assert.match(html, /Goals by period/);
  assert.match(html, /Shots by period/);
  assert.match(html, /OT/);
  // OT is never recorded in this fixture -> must render as missing, not a zero-height bar.
  assert.match(html, /bar-missing/);
});

test('Blocker 2: player rows render a clickable link with the canonical player id, wired to goToPlayerProfile in app.js', () => {
  const roster = [{ source_player_id: 'p1', jersey_number: '9', name: 'Jamie Fox', player_type: 'skater' }];
  const playerStats = [{ source_game_id: 'g1', source_player_id: 'p1', player_type: 'skater', gp: 1, goals: 2, assists: 1 }];
  const analytics = loadAnalytics(bGames);
  const html = analytics.render({ data: { games: bGames, roster, teamStats: bTeamStats, playerStats }, tab: 'players' });
  assert.match(html, /data-analytics-player-link="p1"/);
  assert.match(appSource, /data-analytics-player-link/);
  assert.match(appSource, /goToPlayerProfile\(button\.dataset\.analyticsPlayerLink\)/);
});

test('Blocker 3: game rows render a canonical Game Center link, wired to goToGameCenter in app.js', () => {
  const analytics = loadAnalytics(bGames);
  const html = analytics.render({ data: { games: bGames, roster: [], teamStats: bTeamStats, playerStats: [] }, tab: 'games' });
  assert.match(html, /data-analytics-game-link="g1"/);
  assert.match(appSource, /data-analytics-game-link/);
  assert.match(appSource, /goToGameCenter\(button\.dataset\.analyticsGameLink\)/);
});

test('Blocker 4: a centralized navigateToActionItem adapter routes missing-stats items to Team Stats, and both the dashboard row and Action Center panel use it', () => {
  assert.match(appSource, /function navigateToActionItem\(\{ kind, view, gameId \}\)/);
  assert.match(appSource, /kind === 'missing-stats' && gameId\) \{ goToTeamStats\(gameId\); return; \}/);
  assert.match(appSource, /data-action-kind="\$\{escapeHtml\(item\.kind \|\| ''\)\}"/);
  assert.match(appSource, /navigateToActionItem\(\{ kind: button\.dataset\.actionKind, view: button\.dataset\.dashboardAction, gameId: button\.dataset\.actionGame \}\)/);
  assert.match(appSource, /data-action-center-game="\$\{escapeHtml\(item\.gameId \|\| ''\)\}"/);
  assert.match(appSource, /data-action-center-kind="\$\{escapeHtml\(item\.kind \|\| ''\)\}"/);
  assert.match(appSource, /navigateToActionItem\(\{ kind: item\.dataset\.actionCenterKind, view: item\.dataset\.actionCenterView, gameId: item\.dataset\.actionCenterGame \}\)/);
});

test('Blocker 5: goalie Save% and GAA require the underlying fields recorded together and never fabricate a partial ratio', () => {
  const roster = [{ source_player_id: 'g1p', jersey_number: '30', name: 'Sam Ray', player_type: 'goalie' }];
  const fullyRecorded = [
    { source_game_id: 'a', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 20, goals_against: 2, minutes: 45 },
    { source_game_id: 'b', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 18, goals_against: 3, minutes: 45 }
  ];
  const games2 = [{ source_game_id: 'a', date: '2026-09-01' }, { source_game_id: 'b', date: '2026-09-03' }];
  const analytics = loadAnalytics(games2);
  const fullHtml = analytics.render({ data: { games: games2, roster, teamStats: [], playerStats: fullyRecorded }, tab: 'goalies' });
  assert.match(fullHtml, /88\.4%/); // 38/(38+5) saves/(saves+GA)
  assert.match(fullHtml, /3\.33/); // (2+3)/(90/60)

  const missingSaves = [
    { source_game_id: 'a', source_player_id: 'g1p', player_type: 'goalie', gp: 1, goals_against: 2, minutes: 45 },
    { source_game_id: 'b', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 18, goals_against: 3, minutes: 45 }
  ];
  const missingSavesHtml = analytics.render({ data: { games: games2, roster, teamStats: [], playerStats: missingSaves }, tab: 'goalies' });
  assert.match(missingSavesHtml, /1 of 2 recorded/);

  const missingGA = [
    { source_game_id: 'a', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 20, minutes: 45 },
    { source_game_id: 'b', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 18, goals_against: 3, minutes: 45 }
  ];
  const missingGAHtml = analytics.render({ data: { games: games2, roster, teamStats: [], playerStats: missingGA }, tab: 'goalies' });
  assert.match(missingGAHtml, /1 of 2 recorded/);

  const missingMinutes = [
    { source_game_id: 'a', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 20, goals_against: 2 },
    { source_game_id: 'b', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 18, goals_against: 3 }
  ];
  const missingMinutesHtml = analytics.render({ data: { games: games2, roster, teamStats: [], playerStats: missingMinutes }, tab: 'goalies' });
  const gaaCell = missingMinutesHtml.match(/<tbody>(<tr>.*?<\/tr>)<\/tbody>/s)[1];
  assert.match(gaaCell, /<td>—<\/td><td>2 of 2 recorded<\/td>/);

  const explicitZeros = [{ source_game_id: 'a', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 0, goals_against: 0, minutes: 45 }];
  const zeroGames = [{ source_game_id: 'a', date: '2026-09-01' }];
  const zeroAnalytics = loadAnalytics(zeroGames);
  const zeroHtml = zeroAnalytics.render({ data: { games: zeroGames, roster, teamStats: [], playerStats: explicitZeros }, tab: 'goalies' });
  // 0 saves + 0 GA => 0 recorded shots against; a 0/0 ratio must not be shown as a percentage.
  const zeroRow = zeroHtml.match(/<tbody>(<tr>.*?<\/tr>)<\/tbody>/s)[1];
  assert.match(zeroRow, /<td>0<\/td><td>0<\/td><td>0<\/td><td>—<\/td>/);

  const partialHistorical = [
    { source_game_id: 'a', source_player_id: 'g1p', player_type: 'goalie', gp: 1, saves: 20, goals_against: 2, minutes: 45 },
    { source_game_id: 'b', source_player_id: 'g1p', player_type: 'goalie', gp: 1 }
  ];
  const partialHtml = analytics.render({ data: { games: games2, roster, teamStats: [], playerStats: partialHistorical }, tab: 'goalies' });
  assert.match(partialHtml, /1 of 2 recorded/);
});

test('Blocker 6: NULL vs zero — an explicit 0 renders as 0 and a missing field renders as em dash, never coerced', () => {
  const analytics = loadAnalytics(bGames);
  const html = analytics.render({ data: { games: bGames, roster: [], teamStats: bTeamStats, playerStats: [] }, tab: 'periods' });
  // g2/g3 never recorded goals_for_p1 etc except g1; period table must show the recorded 0 from g1's p2/p3 GA
  // and never show a fabricated total for periods nobody recorded (only g1 has any period data).
  assert.match(html, /<td>P1<\/td>/);
  assert.match(html, /—/);
});

test('Blocker 7: analytics tabs and the shared filter bar have dedicated mobile-safe CSS (no reliance on unset defaults)', () => {
  assert.match(stylesSource, /\.analytics-tabs\{[^}]*overflow-x:auto/);
  assert.match(stylesSource, /@media\(max-width:480px\)\{\.stats-filter-bar label\{flex:1 1 100%/);
  assert.match(stylesSource, /@media\(max-width:420px\)\{\.analytics-tabs/);
});

test('Re-QA Fix 11: Team Stats period inputs get a 44px+ tap target and 16px+ font at the 420px mobile breakpoint (no iOS auto-zoom, no tiny targets)', () => {
  assert.match(stylesSource, /@media\(max-width:420px\)\{\.team-stats-grid\{grid-template-columns:1fr\}.*?\.team-stats-field input\{min-height:44px;font-size:16px\}/);
});

// --- Re-QA regression coverage below ---------------------------------

test('Re-QA Fix 6: PP%/PK% require the success+chances pair recorded together for the same game, and never fabricate a rate from a mismatched sample', () => {
  const games3 = [
    { source_game_id: 'a', date: '2026-09-01' },
    { source_game_id: 'b', date: '2026-09-03' },
    { source_game_id: 'c', date: '2026-09-05' }
  ];
  // g a: chances recorded but success missing (a genuine single-field gap).
  // g b: both recorded (2/4). g c: neither recorded.
  const partialPairStats = [
    { source_game_id: 'a', power_play_chances: 4 },
    { source_game_id: 'b', power_play_success: 2, power_play_chances: 4 }
  ];
  const analytics = loadAnalytics(games3);
  const html = analytics.render({ data: { games: games3, roster: [], teamStats: partialPairStats, playerStats: [] }, tab: 'overview' });
  // Only game b has BOTH fields recorded, so the rate must be 2/4 = 50.0%,
  // not (2 success)/(4+? chances) mixing game a's unpaired chances in.
  assert.match(html, /50\.0%/);
  assert.match(html, /Power-play %<\/td><td>1 games<\/td>/);
});

test('Re-QA Fix 6: an explicit 0/0 recorded pair shows — rather than a fabricated 0.0%', () => {
  const games1 = [{ source_game_id: 'a', date: '2026-09-01' }];
  const zeroPair = [{ source_game_id: 'a', power_play_success: 0, power_play_chances: 0 }];
  const analytics = loadAnalytics(games1);
  const html = analytics.render({ data: { games: games1, roster: [], teamStats: zeroPair, playerStats: [] }, tab: 'special-teams' });
  assert.doesNotMatch(html, /0\.0%/);
});

test('Re-QA Fix 7: goal/shot differential only uses games where both sides of the pair are recorded (differential sample integrity)', () => {
  const games3 = [
    { source_game_id: 'a', date: '2026-09-01' },
    { source_game_id: 'b', date: '2026-09-03' },
    { source_game_id: 'c', date: '2026-09-05' }
  ];
  // g a: only goals_for recorded (goals_against missing) -- must be excluded
  // from the differential entirely, not treated as goals_against = 0.
  const mismatchedStats = [
    { source_game_id: 'a', goals_for: 9 },
    { source_game_id: 'b', goals_for: 3, goals_against: 1 }
  ];
  const analytics = loadAnalytics(games3);
  const html = analytics.render({ data: { games: games3, roster: [], teamStats: mismatchedStats, playerStats: [] }, tab: 'overview' });
  // Only game b is a valid pair: diff = 3 - 1 = +2, from 1 of 3 games, not
  // (9+3) - 1 = +11 from mixing game a's unpaired goals_for in.
  assert.match(html, /\+2/);
  assert.match(html, /Goal differential/);
  assert.match(html, /1 of 3 games recorded/);
  assert.doesNotMatch(html, /\+11/);
});

test('Re-QA Fix 7: period-level goal/shot differentials also require the joint pair, not independent per-field sums', () => {
  const games2 = [{ source_game_id: 'a', date: '2026-09-01' }, { source_game_id: 'b', date: '2026-09-03' }];
  // g a: goals_for_p1 recorded, goals_against_p1 missing.
  // g b: both recorded (2 for, 1 against).
  const stats = [
    { source_game_id: 'a', goals_for_p1: 5 },
    { source_game_id: 'b', goals_for_p1: 2, goals_against_p1: 1 }
  ];
  const analytics = loadAnalytics(games2);
  const html = analytics.render({ data: { games: games2, roster: [], teamStats: stats, playerStats: [] }, tab: 'periods' });
  assert.match(html, /<td>P1<\/td><td>2<\/td><td>1<\/td><td>\+1<\/td>/);
});

test('Re-QA Fix 8: player Points only combine goals+assists from games where both were recorded together, never coercing a missing side to 0', () => {
  const roster = [{ source_player_id: 'p1', jersey_number: '9', name: 'Jamie Fox', player_type: 'skater' }];
  const games2 = [{ source_game_id: 'a', date: '2026-09-01' }, { source_game_id: 'b', date: '2026-09-03' }];
  // g a: goals recorded but assists missing entirely for this player-game.
  const playerStats = [
    { source_game_id: 'a', source_player_id: 'p1', player_type: 'skater', goals: 4 },
    { source_game_id: 'b', source_player_id: 'p1', player_type: 'skater', goals: 1, assists: 2 }
  ];
  const analytics = loadAnalytics(games2);
  const html = analytics.render({ data: { games: games2, roster, teamStats: [], playerStats }, tab: 'players' });
  const row = html.match(/<tbody>(<tr>.*?<\/tr>)<\/tbody>/s)[1];
  // Only game b is a valid goals+assists pair: PTS = 1 + 2 = 3, not
  // (4+1) + (0+2) = 7 from coercing game a's missing assists to 0.
  assert.match(row, /<td>3<\/td>/);
  assert.doesNotMatch(row, /<td>7<\/td>/);
});

test('Re-QA Fix 1: every Stats tab resolves the identical selected-game set as the shared filter bar across mode/modifier combinations', () => {
  const engineSource = fs.readFileSync('web/stats-filter-engine.js', 'utf8');
  const adapterSource = fs.readFileSync('web/stats-filter-context.js', 'utf8');
  const games = [];
  for (let i = 1; i <= 24; i += 1) {
    games.push({ source_game_id: `g${i}`, date: `2026-09-${String(i).padStart(2, '0')}`, opponent: i % 3 === 0 ? 'Rivals' : 'Wolves' });
  }
  const schedule = games.map(game => ({ linked_game_source_id: game.source_game_id, game_type: game.opponent === 'Rivals' ? 'league' : 'exhibition' }));

  function buildContext() {
    const context = { console, globalThis: {} };
    context.globalThis = context;
    vm.runInNewContext(engineSource, context);
    context.phase1Data = { games, schedule };
    context.FoxesFilterContext = context.FoxesStatsFilterEngine.createFilterContext({
      getGames: () => context.phase1Data.games,
      getScheduleGames: () => context.phase1Data.schedule
    });
    vm.runInNewContext(adapterSource, context);
    return context;
  }

  const combos = [
    ['season', {}, {}],
    ['last5', {}, {}],
    ['last10', {}, {}],
    ['last20', {}, {}],
    ['single', { gameId: 'g10' }, {}],
    ['custom', { start: '2026-09-05', end: '2026-09-18' }, {}],
    ['season', {}, { gameType: 'league' }],
    ['season', {}, { opponent: 'Rivals' }],
    ['last10', {}, { opponent: 'Rivals' }],
    ['custom', { start: '2026-09-01', end: '2026-09-20' }, { gameType: 'league', opponent: 'Rivals' }]
  ];
  for (const [mode, params, modifiers] of combos) {
    const context = buildContext();
    context.FoxesFilterContext.setMode(mode, params);
    context.FoxesFilterContext.setModifiers(modifiers);
    const barGameSet = context.FoxesFilterContext.getGameSet();
    const filterContext = context.FoxesStatsFilter.getActiveFilterContext();
    const resolved = context.FoxesStatsFilter.resolveSelectedGames(filterContext, games);
    assert.deepEqual(resolved.map(game => game.source_game_id).sort(), barGameSet.gameIds.slice().sort(),
      `mode=${mode} params=${JSON.stringify(params)} modifiers=${JSON.stringify(modifiers)} must resolve the same game set for every Stats tab as the filter bar`);
  }
});


