/*
 * Temporary boundary for Session B's shared Stats 2.0 selector/calculation
 * module (spec §3). STUB — must be replaced with Session B's real
 * implementation before integration. This is the assumed interface shape,
 * documented verbatim per the parent/integration session so the swap is a
 * drop-in replacement of this file only, with no caller changes required:
 *
 *   getActiveFilterContext() -> { mode, params, gameIds: string[] }
 *   resolveSelectedGames(filterContext, allGames) -> Game[] (ordered, deduped)
 *   getRecordedValue(game, fieldKey) -> { recorded: boolean, value: number|null }
 *   aggregateField(games, fieldKey) -> { sum, count, average }
 *     // count = recorded-only denominator per spec §2
 *
 * This stub only ever resolves "All Season" (mode: 'all-season', every
 * loaded game, no filter params applied). It intentionally does NOT
 * implement the real Last-N / Custom / Game-Type / Opponent resolution
 * logic, and does NOT implement any alternate recorded-vs-missing
 * denominator logic — both belong exclusively to Session B's shared module
 * (spec §3, §3.2). web/analytics-ui.js must only call through these four
 * functions and must never duplicate this math.
 */
(function (root) {
  'use strict';

  if (root.FoxesStatsFilter) return;

  const number = value => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));

  // STUB: always "All Season" with no filter params. Session B's real
  // implementation reads the shared active filter context (§3.2), which
  // tracks the user's selected mode (Single Game / Last N / All Season /
  // Custom) plus any Game Type / Opponent modifiers.
  function getActiveFilterContext() {
    return { mode: 'all-season', params: {}, gameIds: [] };
  }

  // STUB: ignores filterContext entirely (this stub only supports "all
  // games, no filter"). Dedupes by source_game_id and sorts by date
  // descending, reusing the existing app game-ordering convention
  // (see recency sorts already in web/app.js).
  function resolveSelectedGames(filterContext, allGames) {
    const seen = new Set();
    const deduped = (allGames || []).filter(game => {
      const id = game?.source_game_id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return deduped.sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
  }

  // A value is "recorded" per spec §2 when it is present and not
  // null/undefined/empty string. Explicit 0 is recorded and displays as 0;
  // anything else missing is excluded from the denominator of any
  // per-game average.
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
    temporaryStub: true,
    getActiveFilterContext,
    resolveSelectedGames,
    getRecordedValue,
    aggregateField
  });
})(globalThis);
