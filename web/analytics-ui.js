/*
 * Read-only Analytics tabs (spec §6, Session C ownership).
 *
 * All selection and NULL/sample-size semantics are delegated to
 * web/stats-filter-context.js (currently a marked STUB for Session B's
 * shared module — see that file's header comment). This file must only
 * call FoxesStatsFilter.getActiveFilterContext / resolveSelectedGames /
 * getRecordedValue / aggregateField; it must never compute its own
 * filtered game list or its own recorded-vs-missing/average math.
 */
(function (root) {
  'use strict';

  const TABS = Object.freeze([
    ['overview', 'Overview'],
    ['trends', 'Trends'],
    ['special-teams', 'Special Teams'],
    ['periods', 'Periods'],
    ['players', 'Players'],
    ['goalies', 'Goalies'],
    ['games', 'Games']
  ]);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const display = value => value === null || value === undefined || value === '' ? '—' : esc(value);
  const date = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : 'Date unavailable';

  function table(headers, rows, empty = 'No recorded data for this selection.') {
    return `<div class="table-wrap"><table class="data-table analytics-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`;
  }

  // Merges each selected game with its team-stats row (by source_game_id) so
  // getRecordedValue/aggregateField can read team-stat fields directly off
  // the resulting record, without this file computing its own lookup rules.
  function mergedTeamGames(selectedGames, teamStats) {
    const byGame = new Map((teamStats || []).map(row => [row.source_game_id, row]));
    return selectedGames.map(game => ({ ...game, ...(byGame.get(game.source_game_id) || {}) }));
  }

  function cell(filter, game, field) {
    const { recorded, value } = filter.getRecordedValue(game, field);
    return display(recorded ? value : null);
  }

  // Ratio of two paired fields (e.g. PP success/chances) across the given
  // games. Per Phase A contract these fields are always recorded together
  // (unrecorded pair = both null), so summing each field independently via
  // aggregateField yields the correct paired totals.
  function ratioPct(filter, games, numeratorField, denominatorField) {
    const numerator = filter.aggregateField(games, numeratorField).sum;
    const denominator = filter.aggregateField(games, denominatorField).sum;
    if (denominator === null) return '—';
    if (denominator === 0) return '0.0%';
    return `${(numerator / denominator * 100).toFixed(1)}%`;
  }

  function overview(filter, mergedGames) {
    const metric = (label, field) => {
      const { average, count } = filter.aggregateField(mergedGames, field);
      return `<div class="card stat-card"><small>${esc(label)}</small><strong>${display(average === null ? null : average.toFixed(1))}</strong><span>${count} of ${mergedGames.length} recorded</span></div>`;
    };
    const ppCount = filter.aggregateField(mergedGames, 'power_play_success').count;
    const pkCount = filter.aggregateField(mergedGames, 'penalty_kill_success').count;
    return `<div class="grid stat-grid">${metric('Goals for / game', 'goals_for')}${metric('Goals against / game', 'goals_against')}${metric('Shots for / game', 'shots_for')}${metric('Shots against / game', 'shots_against')}</div>
      ${table(['Metric', 'Recorded', 'Average'], [
        `<tr><td>Games in selection</td><td>${mergedGames.length}</td><td>—</td></tr>`,
        `<tr><td>Power-play success</td><td>${ppCount} games</td><td>${ratioPct(filter, mergedGames, 'power_play_success', 'power_play_chances')}</td></tr>`,
        `<tr><td>Penalty-kill success</td><td>${pkCount} games</td><td>${ratioPct(filter, mergedGames, 'penalty_kill_success', 'penalty_kill_chances')}</td></tr>`
      ])}`;
  }

  function trends(filter, mergedGames) {
    return `<p class="sub">Each value uses the selected game set. Missing fields remain unrecorded and are not coerced to zero.</p>${table(['Game', 'Opponent', 'Goals For', 'Goals Against', 'Shots For', 'Shots Against'], mergedGames.map(game => `<tr><td>${esc(date(game.date))}</td><td>${esc(game.opponent || '—')}</td><td>${cell(filter, game, 'goals_for')}</td><td>${cell(filter, game, 'goals_against')}</td><td>${cell(filter, game, 'shots_for')}</td><td>${cell(filter, game, 'shots_against')}</td></tr>`))}`;
  }

  function specialTeams(filter, mergedGames) {
    return table(['Game', 'PP', 'PP%', 'PK', 'PK%'], mergedGames.map(game => `<tr><td>${esc(date(game.date))} · ${esc(game.opponent || '—')}</td><td>${cell(filter, game, 'power_play_success')} / ${cell(filter, game, 'power_play_chances')}</td><td>${ratioPct(filter, [game], 'power_play_success', 'power_play_chances')}</td><td>${cell(filter, game, 'penalty_kill_success')} / ${cell(filter, game, 'penalty_kill_chances')}</td><td>${ratioPct(filter, [game], 'penalty_kill_success', 'penalty_kill_chances')}</td></tr>`));
  }

  function periods(filter, mergedGames) {
    const fields = ['shots_for_p1', 'shots_for_p2', 'shots_for_p3', 'shots_for_ot', 'shots_against_p1', 'shots_against_p2', 'shots_against_p3', 'shots_against_ot'];
    return `<p class="sub">Period goals are not part of the Phase A team-stats contract. This view uses recorded period shots only; OT applicability is intentionally not inferred.</p>${table(['Game', 'For P1', 'For P2', 'For P3', 'For OT', 'Against P1', 'Against P2', 'Against P3', 'Against OT'], mergedGames.map(game => `<tr><td>${esc(date(game.date))} · ${esc(game.opponent || '—')}</td>${fields.map(field => `<td>${cell(filter, game, field)}</td>`).join('')}</tr>`))}`;
  }

  function players(filter, roster, playerStats, gameIds) {
    const idSet = new Set(gameIds);
    const rows = (roster || []).filter(player => String(player.player_type || '').toLowerCase() !== 'goalie' && String(player.position || '').toUpperCase() !== 'G').map(player => {
      const playerRows = (playerStats || []).filter(row => row.source_player_id === player.source_player_id && row.player_type !== 'goalie' && idSet.has(row.source_game_id));
      const gp = filter.aggregateField(playerRows, 'gp');
      const goals = filter.aggregateField(playerRows, 'goals');
      const assists = filter.aggregateField(playerRows, 'assists');
      const shots = filter.aggregateField(playerRows, 'shots');
      const plusMinus = filter.aggregateField(playerRows, 'plus_minus');
      const points = goals.sum === null && assists.sum === null ? null : (goals.sum || 0) + (assists.sum || 0);
      return `<tr><td>#${esc(player.jersey_number)} ${esc(player.name)}</td><td>${display(gp.sum)}</td><td>${display(goals.sum)}</td><td>${display(assists.sum)}</td><td>${display(points)}</td><td>${display(shots.sum)}</td><td>${display(plusMinus.sum)}</td></tr>`;
    });
    return table(['Player', 'GP', 'G', 'A', 'PTS', 'SOG', '+/-'], rows, 'No skater records are available for this selection.');
  }

  function goalies(filter, roster, playerStats, gameIds) {
    const idSet = new Set(gameIds);
    const rows = (roster || []).filter(player => String(player.player_type || '').toLowerCase() === 'goalie' || String(player.position || '').toUpperCase() === 'G').map(player => {
      const playerRows = (playerStats || []).filter(row => row.source_player_id === player.source_player_id && row.player_type === 'goalie' && idSet.has(row.source_game_id));
      const gp = filter.aggregateField(playerRows, 'gp');
      const saves = filter.aggregateField(playerRows, 'saves');
      const goalsAgainst = filter.aggregateField(playerRows, 'goals_against');
      const shotsAgainst = saves.sum === null || goalsAgainst.sum === null ? null : saves.sum + goalsAgainst.sum;
      const savePct = shotsAgainst === null || shotsAgainst === 0 ? null : saves.sum / shotsAgainst;
      return `<tr><td>#${esc(player.jersey_number)} ${esc(player.name)}</td><td>${display(gp.sum)}</td><td>${display(saves.sum)}</td><td>${display(goalsAgainst.sum)}</td><td>${display(shotsAgainst)}</td><td>${savePct === null ? '—' : `${(savePct * 100).toFixed(1)}%`}</td></tr>`;
    });
    return table(['Goalie', 'GP', 'Saves', 'GA', 'SA', 'SV%'], rows, 'No goalie records are available for this selection.');
  }

  function games(mergedGames) {
    return table(['Date', 'Opponent', 'Game type', 'Selected ID'], mergedGames.map(game => `<tr><td>${esc(date(game.date))}</td><td>${esc(game.opponent || '—')}</td><td>${display(game.game_type)}</td><td><code>${esc(game.source_game_id)}</code></td></tr>`), 'No games are available for this season.');
  }

  function render({ data, tab = 'overview' }) {
    const filter = root.FoxesStatsFilter;
    const filterContext = filter.getActiveFilterContext();
    const selectedGames = filter.resolveSelectedGames(filterContext, data.games || []);
    const mergedGames = mergedTeamGames(selectedGames, data.teamStats);
    const gameIds = selectedGames.map(game => game.source_game_id).filter(Boolean);
    const body = tab === 'trends' ? trends(filter, mergedGames)
      : tab === 'special-teams' ? specialTeams(filter, mergedGames)
      : tab === 'periods' ? periods(filter, mergedGames)
      : tab === 'players' ? players(filter, data.roster, data.playerStats, gameIds)
      : tab === 'goalies' ? goalies(filter, data.roster, data.playerStats, gameIds)
      : tab === 'games' ? games(mergedGames)
      : overview(filter, mergedGames);
    const label = TABS.find(([id]) => id === tab)?.[1] || 'Overview';
    const modeLabel = filterContext.mode === 'all-season' ? 'All Season' : filterContext.mode;
    const stubNotice = filter.temporaryStub ? `<div class="callout prototype-note"><strong>${esc(modeLabel)}</strong> · Shared Stats 2.0 filters are pending Session B integration. This temporary adapter selects every loaded game and must be replaced before release.</div>` : '';
    return `<div class="page-head"><div><div class="eyebrow">PUCKNEXUS · ${esc(data.teamName || 'Selected team')} workspace</div><h1>${esc(label)}</h1><p>Analytics from recorded team, player, and goalie game data.</p></div></div>${stubNotice}<nav class="workspace-tabs analytics-tabs" aria-label="Analytics tabs">${TABS.map(([id, name]) => `<button type="button" data-analytics-tab="${id}" aria-pressed="${id === tab}" class="${id === tab ? 'active' : ''}">${name}</button>`).join('')}</nav><section class="card analytics-content">${body}</section>`;
  }

  root.FoxesAnalyticsUI = Object.freeze({ TABS, render });
})(globalThis);
