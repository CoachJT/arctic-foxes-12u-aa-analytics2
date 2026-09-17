/*
 * Real adapter wiring Session C's Analytics UI (web/analytics-ui.js) to
 * Session B's real shared filter engine (web/stats-filter-engine.js) and
 * the shared active filter context instance (window.FoxesFilterContext,
 * created once in web/app.js). This is NOT a stub -- it is a drop-in
 * replacement of the file Session C marked as temporary, per the parent
 * integration plan: only this file changes, web/analytics-ui.js and
 * web/app.js needed no edits.
 *
 * It preserves the exact `window.FoxesStatsFilter` interface Session C
 * built against:
 *
 *   getActiveFilterContext() -> { mode, params, gameIds, modifiers }
 *   resolveSelectedGames(filterContext, allGames) -> Game[] (ordered, deduped)
 *   getRecordedValue(game, fieldKey) -> { recorded: boolean, value: number|null }
 *   aggregateField(games, fieldKey) -> { sum, count, average }
 *
 * getActiveFilterContext/resolveSelectedGames now delegate to Session B's
 * real single-source-of-truth selector (spec §3) instead of a fixed
 * "All Season, no filters" stub. getRecordedValue/aggregateField operate on
 * the already-merged game+team-stats records analytics-ui.js builds before
 * calling them, so their per-field NULL/sample-size semantics (spec §2) are
 * unchanged from what Session C authored and tested.
 */
(function (root) {
  'use strict';

  const number = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

  function getActiveFilterContext() {
    const shared = root.FoxesFilterContext;
    if (!shared) {
      // The shared context should always be created by web/app.js before
      // this adapter is used. Fail loudly rather than silently reverting
      // to a fixed "all games" fallback that could hide a real wiring bug.
      throw new Error('window.FoxesFilterContext is not available. Session B\'s shared filter context must be created before Analytics UI renders.');
    }
    const state = shared.getState();
    const resolved = shared.getGameSet();
    return { mode: state.mode, params: state.params, modifiers: state.modifiers, gameIds: resolved.gameIds };
  }

  // Reuse the authoritative selected IDs and order; schedule data is lexical
  // in app.js and must not be looked up or filtered again through window.
  function resolveSelectedGames(filterContext, allGames) {
    const byId = new Map((allGames || []).map(game => [game.source_game_id, game]));
    return [...new Set(filterContext.gameIds || [])].map(id => byId.get(id)).filter(Boolean);
  }

  // A value is "recorded" per spec §2 when it is present and not
  // null/undefined/empty string. Explicit 0 is recorded and displays as 0;
  // anything else missing is excluded from the denominator of any
  // per-game average. Operates on the already-merged game+team-stats
  // records analytics-ui.js builds (see mergedTeamGames there).
  function getRecordedValue(game, fieldKey) {
    const raw = game?.[fieldKey];
    const isPresent = raw !== null && raw !== undefined && raw !== '';
    return { recorded: isPresent, value: isPresent ? number(raw) : null };
  }

  function aggregateField(games, fieldKey) {
    const recordedValues = (games || [])
      .map(game => getRecordedValue(game, fieldKey))
      .filter(entry => entry.recorded && entry.value !== null)
      .map(entry => entry.value);
    const count = recordedValues.length;
    const sum = count ? recordedValues.reduce((total, value) => total + value, 0) : null;
    const average = count ? sum / count : null;
    return { sum, count, average };
  }

  root.FoxesStatsFilter = Object.freeze({
    temporaryStub: false,
    getActiveFilterContext,
    resolveSelectedGames,
    getRecordedValue,
    aggregateField
  });
})(typeof window !== 'undefined' ? window : globalThis);
