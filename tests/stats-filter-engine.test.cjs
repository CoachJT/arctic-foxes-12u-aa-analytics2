const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('web/stats-filter-engine.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');

function load() {
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.FoxesStatsFilterEngine;
}

const E = load();

// Re-QA Fix 2: the engine's same-date tiebreak (date -> created_at ->
// source_game_id) is only real if the app actually fetches `created_at`.
// Without it every game object has `created_at === undefined`, silently
// degrading the tiebreak to source_game_id-only ordering. This asserts the
// live Supabase read includes the column the engine depends on.
test('Fix 2: the games Supabase read selects created_at so the same-date tiebreak is not silently defeated', () => {
  const gamesRead = appSource.match(/read\('games', 'team_games', '([^']+)'/);
  assert.ok(gamesRead, 'the games read must exist');
  assert.ok(gamesRead[1].split(',').includes('created_at'), 'games select must include created_at for the same-date tiebreak');
});

// 12 games, one per day, descending relevance for "most recent" tests.
// g12 is the most recent (2026-09-12), g1 the oldest (2026-09-01).
const games = Array.from({ length: 12 }, (_, index) => {
  const day = String(index + 1).padStart(2, '0');
  return {
    source_game_id: `g${index + 1}`,
    date: `2026-09-${day}`,
    opponent: index % 3 === 0 ? 'Rivals' : index % 3 === 1 ? 'Wolves' : 'Sharks',
    created_at: `2026-09-${day}T12:00:00Z`
  };
});

const scheduleGames = games.map((game, index) => ({
  linked_game_source_id: game.source_game_id,
  game_type: index % 4 === 0 ? 'Playoff' : 'League'
}));

test('single mode selects exactly the requested game', () => {
  const result = E.computeGameSet({ games, mode: 'single', params: { gameId: 'g5' } });
  assert.deepEqual(result.gameIds, ['g5']);
  assert.equal(result.available, 1);
  assert.equal(result.note, null);
});

test('single mode with an unknown game id yields an empty set, not a fabricated game', () => {
  const result = E.computeGameSet({ games, mode: 'single', params: { gameId: 'does-not-exist' } });
  assert.deepEqual(result.gameIds, []);
});

test('lastN modes take the N most recent games by date descending', () => {
  const result = E.computeGameSet({ games, mode: 'last5', params: {} });
  assert.deepEqual(result.gameIds, ['g12', 'g11', 'g10', 'g9', 'g8']);
  assert.equal(result.note, null);
});

test('lastN falls back to all available games and reports the actual count used', () => {
  const fewGames = games.slice(0, 7); // only 7 exist
  const result = E.computeGameSet({ games: fewGames, mode: 'last10', params: {} });
  assert.equal(result.available, 7);
  assert.equal(result.gameIds.length, 7);
  assert.equal(result.note, 'Last 10 (7 available)');
});

test('same-date games are broken by created_at, then by source_game_id, never dropped or duplicated', () => {
  const tied = [
    { source_game_id: 'a', date: '2026-09-01', created_at: '2026-09-01T10:00:00Z' },
    { source_game_id: 'b', date: '2026-09-01', created_at: '2026-09-01T12:00:00Z' },
    { source_game_id: 'c', date: '2026-09-01', created_at: '2026-09-01T12:00:00Z' } // ties again -> id tiebreak
  ];
  const result = E.computeGameSet({ games: tied, mode: 'season', params: {} });
  assert.deepEqual(result.gameIds, ['c', 'b', 'a']);
});

test('season mode returns every supplied game (callers already season-scope the data)', () => {
  const result = E.computeGameSet({ games, mode: 'season', params: {} });
  assert.equal(result.available, 12);
  assert.equal(result.note, null);
});

test('custom mode is an inclusive date range', () => {
  const result = E.computeGameSet({ games, mode: 'custom', params: { start: '2026-09-03', end: '2026-09-05' } });
  assert.deepEqual(result.gameIds.slice().sort(), ['g3', 'g4', 'g5']);
});

test('unknown mode is rejected rather than silently defaulting', () => {
  assert.throws(() => E.computeGameSet({ games, mode: 'bogus', params: {} }));
});

test('Game Type modifier layers on top of a base range mode (composition, not a standalone mode)', () => {
  const base = E.computeGameSet({ games, mode: 'last20', params: {} });
  const result = E.applyModifiers(base, scheduleGames, { gameType: 'Playoff' });
  // Playoff games are index 0, 4, 8 -> g1, g5, g9
  assert.deepEqual(result.gameIds.slice().sort(), ['g1', 'g5', 'g9']);
  assert.equal(result.mode, 'last20');
});

test('Opponent modifier layers on top of a base range mode', () => {
  const base = E.computeGameSet({ games, mode: 'season', params: {} });
  const result = E.applyModifiers(base, scheduleGames, { opponent: 'Wolves' });
  assert.ok(result.games.every(game => game.opponent === 'Wolves'));
  assert.ok(result.games.length > 0);
});

test('Game Type and Opponent can compose together', () => {
  const base = E.computeGameSet({ games, mode: 'season', params: {} });
  const result = E.applyModifiers(base, scheduleGames, { gameType: 'League', opponent: 'Sharks' });
  assert.ok(result.games.every(game => game.opponent === 'Sharks'));
  const typeByGame = new Map(scheduleGames.map(row => [row.linked_game_source_id, row.game_type]));
  assert.ok(result.games.every(game => typeByGame.get(game.source_game_id) === 'League'));
});

test('applyModifiers with no modifiers returns the base result unchanged', () => {
  const base = E.computeGameSet({ games, mode: 'last5', params: {} });
  const result = E.applyModifiers(base, scheduleGames, {});
  assert.deepEqual(result.gameIds, base.gameIds);
});

// --- §2 binding NULL vs sample-size rule ---------------------------------

test('aggregateField: 0 is a recorded value, missing is excluded from the denominator (binding example)', () => {
  const tenGames = games.slice(0, 10);
  const statsByGame = new Map();
  // Exactly 4 of the 10 games have a recorded value for "shots_for"; one of
  // those recorded values is an explicit 0.
  statsByGame.set('g1', { shots_for: 20 });
  statsByGame.set('g2', { shots_for: 0 });
  statsByGame.set('g3', { shots_for: 10 });
  statsByGame.set('g4', { shots_for: 5 });
  // g5..g10 have no stats row at all, or a null shots_for.
  statsByGame.set('g5', { shots_for: null });

  const result = E.aggregateField(tenGames, statsByGame, 'shots_for');
  assert.equal(result.recordedCount, 4);
  assert.equal(result.sum, 35);
  assert.equal(result.average, 35 / 4);
});

test('aggregateField returns a null average, not zero or NaN, when nothing was recorded', () => {
  const result = E.aggregateField(games, new Map(), 'shots_for');
  assert.equal(result.recordedCount, 0);
  assert.equal(result.average, null);
});

test('aggregateFields computes several fields against the same shared rule', () => {
  const statsByGame = new Map([
    ['g1', { goals_for: 3, shots_for: 20 }],
    ['g2', { goals_for: 0, shots_for: null }]
  ]);
  const result = E.aggregateFields(games.slice(0, 2), statsByGame, ['goals_for', 'shots_for']);
  assert.equal(result.goals_for.recordedCount, 2);
  assert.equal(result.goals_for.average, 1.5);
  assert.equal(result.shots_for.recordedCount, 1);
  assert.equal(result.shots_for.average, 20);
});

// --- Active filter context (§3.2) -----------------------------------------

test('filter context recomputes the same game set deterministically for every consumer', () => {
  const ctx = E.createFilterContext({ getGames: () => games, getScheduleGames: () => scheduleGames });
  ctx.setMode('last5', {});
  const a = ctx.getGameSet();
  const b = ctx.getGameSet();
  assert.deepEqual(a.gameIds, b.gameIds);
});

test('filter context setMode/setModifiers changes are reflected in getGameSet', () => {
  const ctx = E.createFilterContext({ getGames: () => games, getScheduleGames: () => scheduleGames });
  ctx.setMode('season', {});
  assert.equal(ctx.getGameSet().available, 12);
  ctx.setModifiers({ opponent: 'Wolves' });
  assert.ok(ctx.getGameSet().games.every(game => game.opponent === 'Wolves'));
});

test('filter context notifies subscribers on every state change', () => {
  const ctx = E.createFilterContext({ getGames: () => games, getScheduleGames: () => scheduleGames });
  let calls = 0;
  let lastState = null;
  const unsubscribe = ctx.subscribe((result, state) => { calls += 1; lastState = state; });
  ctx.setMode('last10', {});
  ctx.setModifiers({ gameType: 'League' });
  assert.equal(calls, 2);
  assert.equal(lastState.mode, 'last10');
  assert.deepEqual(lastState.modifiers.gameType, 'League');
  unsubscribe();
  ctx.setMode('season', {});
  assert.equal(calls, 2); // no further notifications after unsubscribe
});

test('filter context getState is a defensive copy, not a live reference', () => {
  const ctx = E.createFilterContext({ getGames: () => games, getScheduleGames: () => scheduleGames });
  const state = ctx.getState();
  state.mode = 'mutated';
  assert.equal(ctx.getState().mode, 'season');
});
