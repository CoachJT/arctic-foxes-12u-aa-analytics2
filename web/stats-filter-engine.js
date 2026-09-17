(function attachStatsFilterEngine(global) {
  // Stats 2.0 global filter engine (Session B / spec §3).
  //
  // This is the ONE shared module that computes "the currently selected
  // game set" and its per-field aggregates. Game Center, Stats, and
  // Analytics must all read from this module (or the shared context it
  // creates below) rather than each filtering games or averaging stats on
  // their own — see docs/game-center-stats-2-frontend-spec.md §3 and §2.
  //
  // Pure functions only: no fetches, no DOM, no writes. Callers supply the
  // already-loaded `team_games` / `team_schedule_games` / per-game stats
  // rows (e.g. from `phase1Data`).

  const BASE_MODES = ['single', 'last5', 'last10', 'last20', 'season', 'custom'];
  const LAST_N = { last5: 5, last10: 10, last20: 20 };

  function str(value) { return value === null || value === undefined ? '' : String(value); }

  // Most-recent-first ordering. Ties (same date) are broken by created_at
  // descending -- there is no existing tiebreak for same-date games
  // anywhere else in the app (checked dashboard.js, game-visibility.js,
  // film-room.js); created_at mirrors the ordering convention film-room.js
  // already uses for its own listings. source_game_id is the final,
  // fully-deterministic tiebreak.
  function compareMostRecentFirst(a, b) {
    return str(b.date).localeCompare(str(a.date))
      || str(b.created_at).localeCompare(str(a.created_at))
      || str(b.source_game_id).localeCompare(str(a.source_game_id));
  }

  function sortedMostRecentFirst(games) {
    return (games || []).slice().sort(compareMostRecentFirst);
  }

  function toResult(mode, params, games, requested) {
    const available = games.length;
    const note = requested != null && available < requested
      ? `${mode === 'single' ? 'Single Game' : `Last ${requested}`} (${available} available)`
      : null;
    return {
      mode,
      params: params || {},
      games,
      gameIds: games.map(game => game.source_game_id),
      requested: requested ?? null,
      available,
      note
    };
  }

  // Base range modes (§3.1). Game Type / Opponent are layered on top via
  // applyModifiers(), never handled here -- they are modifiers, not
  // standalone modes.
  function computeGameSet({ games, mode, params } = {}) {
    if (!BASE_MODES.includes(mode)) {
      throw new Error(`Unknown filter mode "${mode}". Allowed: ${BASE_MODES.join(', ')}`);
    }
    const all = games || [];

    if (mode === 'single') {
      const match = all.filter(game => game.source_game_id === params?.gameId);
      return toResult(mode, params, sortedMostRecentFirst(match), 1);
    }

    if (mode in LAST_N) {
      const n = LAST_N[mode];
      const sliced = sortedMostRecentFirst(all).slice(0, n);
      return toResult(mode, params, sliced, n);
    }

    if (mode === 'season') {
      // Callers already load games scoped to the active team + season
      // (see phase1Data in web/app.js), so "All Season" is simply every
      // supplied game -- no additional season filtering happens here.
      return toResult(mode, params, sortedMostRecentFirst(all), null);
    }

    // custom: inclusive date range within whatever games were supplied.
    const start = params?.start ? str(params.start) : null;
    const end = params?.end ? str(params.end) : null;
    const inRange = all.filter(game => {
      const date = str(game.date);
      if (start && date < start) return false;
      if (end && date > end) return false;
      return true;
    });
    return toResult(mode, params, sortedMostRecentFirst(inRange), null);
  }

  // Builds source_game_id -> game_type lookup by joining team_games to
  // team_schedule_games via linked_game_source_id (the only place
  // game_type exists; team_games itself has no game_type column).
  function gameTypeByGameId(scheduleGames) {
    const map = new Map();
    (scheduleGames || []).forEach(row => {
      if (row.linked_game_source_id) map.set(row.linked_game_source_id, row.game_type);
    });
    return map;
  }

  function normalizedList(value) {
    if (value === null || value === undefined || value === '') return null;
    const list = Array.isArray(value) ? value : [value];
    const cleaned = list.map(item => str(item).trim().toLowerCase()).filter(Boolean);
    return cleaned.length ? cleaned : null;
  }

  // Layers Game Type and/or Opponent on top of an already-computed base
  // range result (§3.1: "the most recent 20 games, filtered further to
  // that opponent"). Returns the same shape as computeGameSet().
  function applyModifiers(baseResult, scheduleGames, modifiers = {}) {
    const gameTypes = normalizedList(modifiers.gameType);
    const opponents = normalizedList(modifiers.opponent);
    if (!gameTypes && !opponents) {
      return { ...baseResult, modifiers: { gameType: null, opponent: null } };
    }
    const typeByGame = gameTypes ? gameTypeByGameId(scheduleGames) : null;
    const filtered = baseResult.games.filter(game => {
      if (opponents && !opponents.includes(str(game.opponent).trim().toLowerCase())) return false;
      if (gameTypes) {
        const type = typeByGame.get(game.source_game_id);
        if (!type || !gameTypes.includes(str(type).trim().toLowerCase())) return false;
      }
      return true;
    });
    return {
      ...baseResult,
      games: filtered,
      gameIds: filtered.map(game => game.source_game_id),
      available: filtered.length,
      modifiers: { gameType: modifiers.gameType ?? null, opponent: modifiers.opponent ?? null }
    };
  }

  // The one shared NULL/sample-size rule (§2, binding for every stat in
  // Stats 2.0 / Analytics): 0 is a recorded value; null/undefined is
  // excluded from the denominator entirely, per field, per game.
  function aggregateField(games, statsByGame, fieldName) {
    let sum = 0;
    let recordedCount = 0;
    (games || []).forEach(game => {
      const stats = statsByGame?.get ? statsByGame.get(game.source_game_id) : statsByGame?.[game.source_game_id];
      if (!stats) return;
      const value = stats[fieldName];
      if (value === null || value === undefined) return;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      sum += numeric;
      recordedCount += 1;
    });
    return { sum, recordedCount, average: recordedCount > 0 ? sum / recordedCount : null };
  }

  function aggregateFields(games, statsByGame, fieldNames) {
    const out = {};
    (fieldNames || []).forEach(name => { out[name] = aggregateField(games, statsByGame, name); });
    return out;
  }

  // The shared "active filter context" (§3.2): one instance, created once
  // by Session B's app.js wiring and exposed as window.FoxesFilterContext,
  // so Game Center / Stats / Analytics all read the same selected game
  // set instead of each fetching/filtering independently.
  function createFilterContext({ getGames, getScheduleGames } = {}) {
    let state = { mode: 'season', params: {}, modifiers: { gameType: null, opponent: null } };
    const listeners = new Set();

    function notify() {
      const result = getGameSet();
      listeners.forEach(fn => fn(result, getState()));
    }

    function getState() {
      return { mode: state.mode, params: { ...state.params }, modifiers: { ...state.modifiers } };
    }

    function setMode(mode, params = {}) {
      state = { ...state, mode, params };
      notify();
    }

    function setModifiers(modifiers = {}) {
      state = { ...state, modifiers: { ...state.modifiers, ...modifiers } };
      notify();
    }

    // Recomputed deterministically from the current games/schedule data and
    // the current filter state every time it is called, so every consumer
    // in the same render pass gets the identical game set -- no
    // independent per-card fetching or filtering (§3.2).
    function getGameSet() {
      const base = computeGameSet({ games: getGames ? getGames() : [], mode: state.mode, params: state.params });
      return applyModifiers(base, getScheduleGames ? getScheduleGames() : [], state.modifiers);
    }

    function subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }

    return { getState, setMode, setModifiers, getGameSet, subscribe };
  }

  global.FoxesStatsFilterEngine = {
    BASE_MODES,
    computeGameSet,
    applyModifiers,
    aggregateField,
    aggregateFields,
    createFilterContext
  };
  if (typeof module !== 'undefined') module.exports = global.FoxesStatsFilterEngine;
}(typeof window !== 'undefined' ? window : globalThis));
