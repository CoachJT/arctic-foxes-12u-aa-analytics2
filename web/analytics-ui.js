/* Read-only Analytics tabs. Selection and NULL/sample-size semantics belong to Session B. */
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
  const pct = (success, chances) => success === null || chances === null || chances === undefined || Number(chances) === 0 ? (success === null || chances === null || chances === undefined ? '—' : '0.0%') : `${(Number(success) / Number(chances) * 100).toFixed(1)}%`;
  const date = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : 'Date unavailable';

  function table(headers, rows, empty = 'No recorded data for this selection.') {
    return `<div class="table-wrap"><table class="data-table analytics-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`;
  }

  function teamRows(context) {
    const byGame = new Map((context.teamStats || []).map(row => [row.source_game_id, row]));
    return context.selectedGames.map(game => ({ game, stats: byGame.get(game.source_game_id) || {} }));
  }

  function overview(context) {
    const rows = teamRows(context);
    const stats = rows.map(row => row.stats);
    const metric = (label, field) => {
      const average = context.average(stats, field);
      const count = context.recordedCount(stats, field);
      return `<div class="card stat-card"><small>${esc(label)}</small><strong>${display(average === null ? null : average.toFixed(1))}</strong><span>${count} of ${context.actualCount} recorded</span></div>`;
    };
    return `<div class="grid stat-grid">${metric('Goals for / game', 'goals_for')}${metric('Goals against / game', 'goals_against')}${metric('Shots for / game', 'shots_for')}${metric('Shots against / game', 'shots_against')}</div>
      ${table(['Metric', 'Recorded', 'Average'], [
        `<tr><td>Games in selection</td><td>${context.actualCount} of ${context.availableCount}</td><td>—</td></tr>`,
        `<tr><td>Power-play success</td><td>${context.recordedCount(stats, 'power_play_success')} games</td><td>${context.ratio(stats, 'power_play_success', 'power_play_chances') === null ? '—' : `${(context.ratio(stats, 'power_play_success', 'power_play_chances') * 100).toFixed(1)}%`}</td></tr>`,
        `<tr><td>Penalty-kill success</td><td>${context.recordedCount(stats, 'penalty_kill_success')} games</td><td>${context.ratio(stats, 'penalty_kill_success', 'penalty_kill_chances') === null ? '—' : `${(context.ratio(stats, 'penalty_kill_success', 'penalty_kill_chances') * 100).toFixed(1)}%`}</td></tr>`
      ])}`;
  }

  function trends(context) {
    const rows = teamRows(context);
    return `<p class="sub">Each value uses the selected game set. Missing fields remain unrecorded and are not coerced to zero.</p>${table(['Game', 'Opponent', 'Goals For', 'Goals Against', 'Shots For', 'Shots Against'], rows.map(({ game, stats }) => `<tr><td>${esc(date(game.date))}</td><td>${esc(game.opponent || '—')}</td><td>${display(stats.goals_for)}</td><td>${display(stats.goals_against)}</td><td>${display(stats.shots_for)}</td><td>${display(stats.shots_against)}</td></tr>`))}`;
  }

  function specialTeams(context) {
    const rows = teamRows(context);
    return table(['Game', 'PP', 'PP%', 'PK', 'PK%'], rows.map(({ game, stats }) => `<tr><td>${esc(date(game.date))} · ${esc(game.opponent || '—')}</td><td>${display(stats.power_play_success)} / ${display(stats.power_play_chances)}</td><td>${pct(stats.power_play_success ?? null, stats.power_play_chances ?? null)}</td><td>${display(stats.penalty_kill_success)} / ${display(stats.penalty_kill_chances)}</td><td>${pct(stats.penalty_kill_success ?? null, stats.penalty_kill_chances ?? null)}</td></tr>`));
  }

  function periods(context) {
    const rows = teamRows(context);
    return `<p class="sub">Period goals are not part of the Phase A team-stats contract. This view uses recorded period shots only; OT applicability is intentionally not inferred.</p>${table(['Game', 'For P1', 'For P2', 'For P3', 'For OT', 'Against P1', 'Against P2', 'Against P3', 'Against OT'], rows.map(({ game, stats }) => `<tr><td>${esc(date(game.date))} · ${esc(game.opponent || '—')}</td>${['shots_for_p1', 'shots_for_p2', 'shots_for_p3', 'shots_for_ot', 'shots_against_p1', 'shots_against_p2', 'shots_against_p3', 'shots_against_ot'].map(field => `<td>${display(stats[field])}</td>`).join('')}</tr>`))}`;
  }

  function players(context, roster) {
    const stats = context.playerStats || [];
    const rows = (roster || []).filter(player => String(player.player_type || '').toLowerCase() !== 'goalie' && String(player.position || '').toUpperCase() !== 'G').map(player => {
      const playerRows = stats.filter(row => row.source_player_id === player.source_player_id && row.player_type !== 'goalie');
      const sum = field => context.sum(playerRows, field);
      return `<tr><td>#${esc(player.jersey_number)} ${esc(player.name)}</td><td>${display(sum('gp'))}</td><td>${display(sum('goals'))}</td><td>${display(sum('assists'))}</td><td>${sum('goals') === null && sum('assists') === null ? '—' : display((sum('goals') || 0) + (sum('assists') || 0))}</td><td>${display(sum('shots'))}</td><td>${display(sum('plus_minus'))}</td></tr>`;
    });
    return table(['Player', 'GP', 'G', 'A', 'PTS', 'SOG', '+/-'], rows, 'No skater records are available for this selection.');
  }

  function goalies(context, roster) {
    const stats = context.playerStats || [];
    const rows = (roster || []).filter(player => String(player.player_type || '').toLowerCase() === 'goalie' || String(player.position || '').toUpperCase() === 'G').map(player => {
      const playerRows = stats.filter(row => row.source_player_id === player.source_player_id && row.player_type === 'goalie');
      const saves = context.sum(playerRows, 'saves');
      const goalsAgainst = context.sum(playerRows, 'goals_against');
      const shotsAgainst = saves === null || goalsAgainst === null ? null : saves + goalsAgainst;
      return `<tr><td>#${esc(player.jersey_number)} ${esc(player.name)}</td><td>${display(context.sum(playerRows, 'gp'))}</td><td>${display(saves)}</td><td>${display(goalsAgainst)}</td><td>${display(shotsAgainst)}</td><td>${shotsAgainst === null ? '—' : `${(saves / shotsAgainst * 100).toFixed(1)}%`}</td></tr>`;
    });
    return table(['Goalie', 'GP', 'Saves', 'GA', 'SA', 'SV%'], rows, 'No goalie records are available for this selection.');
  }

  function games(context) {
    return table(['Date', 'Opponent', 'Game type', 'Selected ID'], context.selectedGames.map(game => `<tr><td>${esc(date(game.date))}</td><td>${esc(game.opponent || '—')}</td><td>${display(game.game_type)}</td><td><code>${esc(game.source_game_id)}</code></td></tr>`), 'No games are available for this season.');
  }

  function render({ data, tab = 'overview' }) {
    const filter = root.FoxesStatsFilter;
    const context = filter.createContext({ games: data.games, teamStats: data.teamStats, playerStats: data.playerStats });
    const body = tab === 'trends' ? trends(context)
      : tab === 'special-teams' ? specialTeams(context)
      : tab === 'periods' ? periods(context)
      : tab === 'players' ? players(context, data.roster)
      : tab === 'goalies' ? goalies(context, data.roster)
      : tab === 'games' ? games(context)
      : overview(context);
    const label = TABS.find(([id]) => id === tab)?.[1] || 'Overview';
    const stubNotice = filter.temporaryStub ? '<div class="callout prototype-note"><strong>All Season</strong> · Shared Stats 2.0 filters are pending Session B integration. This temporary adapter selects every loaded game and must be replaced before release.</div>' : '';
    return `<div class="page-head"><div><div class="eyebrow">PUCKNEXUS · ${esc(data.teamName || 'Selected team')} workspace</div><h1>${esc(label)}</h1><p>Analytics from recorded team, player, and goalie game data.</p></div></div>${stubNotice}<nav class="workspace-tabs analytics-tabs" aria-label="Analytics tabs">${TABS.map(([id, name]) => `<button type="button" data-analytics-tab="${id}" aria-pressed="${id === tab}" class="${id === tab ? 'active' : ''}">${name}</button>`).join('')}</nav><section class="card analytics-content">${body}</section>`;
  }

  root.FoxesAnalyticsUI = Object.freeze({ TABS, render });
})(globalThis);
