/*
 * Read-only Analytics tabs (spec §6, Session C ownership).
 *
 * All selection and NULL/sample-size semantics are delegated to
 * web/stats-filter-context.js, the real adapter over Session B's shared
 * filter engine (window.FoxesStatsFilterEngine / window.FoxesFilterContext).
 * This file must only call FoxesStatsFilter.getActiveFilterContext /
 * resolveSelectedGames / getRecordedValue / aggregateField; it must never
 * compute its own filtered game list or its own recorded-vs-missing math.
 *
 * NULL vs zero invariant (spec §2, enforced everywhere below):
 *   0 = the field was recorded and is actually zero.
 *   '—' = the field was not recorded for that game/player and is excluded
 *         from every sum/average/chart bar. Missing values are never
 *         coerced to 0 for display, aggregation, or charting.
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
  const signed = value => value === null ? '—' : value > 0 ? `+${value}` : String(value);

  function table(headers, rows, empty = 'No recorded data for this selection.') {
    return `<div class="table-wrap"><table class="data-table analytics-table"><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${headers.length}">${empty}</td></tr>`}</tbody></table></div>`;
  }

  function card(label, value, note) {
    return `<div class="card stat-card"><small>${esc(label)}</small><strong>${display(value)}</strong><span>${esc(note)}</span></div>`;
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

  // Only includes a game's pair of fields in the totals when BOTH were
  // actually recorded for that game (spec §2's per-field rule, applied
  // jointly so a ratio/differential never mixes an independently-recorded
  // numerator with an independently-recorded denominator/counterpart from a
  // different set of games -- a real single-game gap in either field must
  // drop that game from the pair, not silently borrow the other field's
  // sample).
  function pairedAggregate(filter, rows, fieldA, fieldB) {
    let sumA = 0, sumB = 0, count = 0;
    (rows || []).forEach(row => {
      const a = filter.getRecordedValue(row, fieldA);
      const b = filter.getRecordedValue(row, fieldB);
      if (a.recorded && b.recorded) { sumA += a.value; sumB += b.value; count += 1; }
    });
    return count ? { sumA, sumB, count } : { sumA: null, sumB: null, count: 0 };
  }

  // Ratio of two paired fields (e.g. PP success/chances) across the given
  // games. Uses pairedAggregate rather than two independent aggregateField
  // calls so a game missing only one side of the pair never contributes a
  // mismatched numerator/denominator to the rate.
  function pairedRatio(filter, games, numeratorField, denominatorField) {
    const paired = pairedAggregate(filter, games, numeratorField, denominatorField);
    if (!paired.count || !paired.sumB) return { rate: null, count: paired.count, sumA: paired.sumA, sumB: paired.sumB };
    return { rate: (paired.sumA / paired.sumB) * 100, count: paired.count, sumA: paired.sumA, sumB: paired.sumB };
  }
  const pct = value => value === null ? '—' : `${value.toFixed(1)}%`;

  function computeRecord(filter, games) {
    let w = 0, l = 0, t = 0, recorded = 0;
    (games || []).forEach(game => {
      const gf = filter.getRecordedValue(game, 'goals_for');
      const ga = filter.getRecordedValue(game, 'goals_against');
      if (!gf.recorded || !ga.recorded) return;
      recorded += 1;
      if (gf.value > ga.value) w += 1; else if (gf.value < ga.value) l += 1; else t += 1;
    });
    return { w, l, t, recorded };
  }

  // A hand-rolled bar chart (no chart library, matching the existing
  // dashboard sparkline/bar-col approach). A missing observation renders as
  // a flat "not recorded" marker, never as a zero-height bar, so absence of
  // data is never visually confused with a real zero.
  function dualBarChart(filter, games, forField, againstField, label) {
    const points = (games || []).map(game => ({
      label: date(game.date),
      forVal: filter.getRecordedValue(game, forField),
      againstVal: filter.getRecordedValue(game, againstField)
    }));
    const recordedValues = points.flatMap(point => [point.forVal.recorded ? point.forVal.value : null, point.againstVal.recorded ? point.againstVal.value : null]).filter(value => value !== null);
    if (!recordedValues.length) return `<p class="sub">No recorded ${esc(label)} data for this selection.</p>`;
    const max = Math.max(...recordedValues, 1);
    const bars = points.map(point => {
      const forBar = point.forVal.recorded ? `<i class="bar-for" style="height:${Math.max(4, (point.forVal.value / max) * 100)}%" title="For: ${point.forVal.value}"></i>` : '<i class="bar-missing" title="Not recorded"></i>';
      const againstBar = point.againstVal.recorded ? `<i class="bar-against" style="height:${Math.max(4, (point.againstVal.value / max) * 100)}%" title="Against: ${point.againstVal.value}"></i>` : '<i class="bar-missing" title="Not recorded"></i>';
      return `<div class="bar-col dual"><span class="bar-pair">${forBar}${againstBar}</span><b>${esc(point.label)}</b></div>`;
    }).join('');
    return `<div class="analytics-bar-chart dual-bar-chart" role="img" aria-label="${esc(label)} by game">${bars}</div><p class="chart-legend"><span class="legend-dot for"></span>For<span class="legend-dot against"></span>Against</p>`;
  }

  // Single-series percentage bar chart for PP%/PK% per game. A game where
  // the chances field is recorded but zero (no opportunities that game) is
  // correctly excluded rather than shown as a fabricated 0%.
  function pctBarChart(filter, games, successField, chancesField, label) {
    const points = (games || []).map(game => {
      const success = filter.getRecordedValue(game, successField);
      const chances = filter.getRecordedValue(game, chancesField);
      const value = success.recorded && chances.recorded && chances.value > 0 ? (success.value / chances.value) * 100 : null;
      return { label: date(game.date), value };
    });
    if (!points.some(point => point.value !== null)) return `<p class="sub">No recorded ${esc(label)} data for this selection.</p>`;
    const bars = points.map(point => point.value === null
      ? `<div class="bar-col"><i class="bar-missing" title="Not recorded"></i><b>${esc(point.label)}</b></div>`
      : `<div class="bar-col"><i style="height:${Math.max(4, point.value)}%" title="${point.value.toFixed(1)}%"></i><b>${esc(point.label)}</b></div>`).join('');
    return `<div class="analytics-bar-chart" role="img" aria-label="${esc(label)} trend by game">${bars}</div>`;
  }

  function recentFormChips(filter, games) {
    const recent = (games || []).slice(0, 5);
    if (!recent.length) return '<p class="sub">No games in this selection.</p>';
    const chips = recent.map(game => {
      const gf = filter.getRecordedValue(game, 'goals_for');
      const ga = filter.getRecordedValue(game, 'goals_against');
      const result = !gf.recorded || !ga.recorded ? null : gf.value > ga.value ? 'W' : gf.value < ga.value ? 'L' : 'T';
      const cls = result === 'W' ? 'win' : result === 'L' ? 'loss' : result === 'T' ? 'tie' : 'unrecorded';
      return `<span class="form-chip result-${cls}" title="${esc(date(game.date))}${game.opponent ? ` vs ${esc(game.opponent)}` : ''}">${result || '—'}</span>`;
    }).join('');
    return `<div class="recent-form">${chips}</div>`;
  }

  function overview(filter, mergedGames) {
    const metric = (label, field) => {
      const { average, count } = filter.aggregateField(mergedGames, field);
      return card(label, average === null ? null : average.toFixed(1), `${count} of ${mergedGames.length} recorded`);
    };
    const record = computeRecord(filter, mergedGames);
    // Differentials use the joint (paired) sample: a game recorded on only
    // one side of GF/GA (or SF/SA) can't contribute a real differential, so
    // it must not be silently included via two independent sums.
    const goalPair = pairedAggregate(filter, mergedGames, 'goals_for', 'goals_against');
    const shotPair = pairedAggregate(filter, mergedGames, 'shots_for', 'shots_against');
    const goalDiff = goalPair.count ? goalPair.sumA - goalPair.sumB : null;
    const shotDiff = shotPair.count ? shotPair.sumA - shotPair.sumB : null;
    const cards = [
      card('Record', record.recorded ? `${record.w}-${record.l}-${record.t}` : null, `${record.recorded} of ${mergedGames.length} games recorded`),
      metric('GF/G', 'goals_for'),
      metric('GA/G', 'goals_against'),
      metric('SF/G', 'shots_for'),
      metric('SA/G', 'shots_against'),
      card('Goal differential', goalDiff === null ? null : signed(goalDiff), `${goalPair.count} of ${mergedGames.length} games recorded`),
      card('Shot differential', shotDiff === null ? null : signed(shotDiff), `${shotPair.count} of ${mergedGames.length} games recorded`)
    ].join('');
    const pp = pairedRatio(filter, mergedGames, 'power_play_success', 'power_play_chances');
    const pk = pairedRatio(filter, mergedGames, 'penalty_kill_success', 'penalty_kill_chances');
    return `<div class="grid stat-grid">${cards}</div>
      ${table(['Metric', 'Recorded', 'Value'], [
        `<tr><td>Games in selection</td><td>${mergedGames.length}</td><td>—</td></tr>`,
        `<tr><td>Power-play %</td><td>${pp.count} games</td><td>${pct(pp.rate)}</td></tr>`,
        `<tr><td>Penalty-kill %</td><td>${pk.count} games</td><td>${pct(pk.rate)}</td></tr>`
      ])}`;
  }

  function trends(filter, mergedGames) {
    return `<p class="sub">Charts use only recorded values from the current selection. A missing observation is skipped, not plotted as zero.</p>
      <div class="analytics-chart-block"><h3>Goals for vs. against</h3>${dualBarChart(filter, mergedGames, 'goals_for', 'goals_against', 'Goals')}</div>
      <div class="analytics-chart-block"><h3>Shots for vs. against</h3>${dualBarChart(filter, mergedGames, 'shots_for', 'shots_against', 'Shots')}</div>
      <div class="analytics-chart-block"><h3>Recent form</h3>${recentFormChips(filter, mergedGames)}</div>
      <div class="analytics-chart-block"><h3>Power-play trend</h3>${pctBarChart(filter, mergedGames, 'power_play_success', 'power_play_chances', 'Power play')}</div>
      <div class="analytics-chart-block"><h3>Penalty-kill trend</h3>${pctBarChart(filter, mergedGames, 'penalty_kill_success', 'penalty_kill_chances', 'Penalty kill')}</div>`;
  }

  function specialTeams(filter, mergedGames) {
    const pp = pairedRatio(filter, mergedGames, 'power_play_success', 'power_play_chances');
    const pk = pairedRatio(filter, mergedGames, 'penalty_kill_success', 'penalty_kill_chances');
    const ppChances = filter.aggregateField(mergedGames, 'power_play_chances');
    const pkChances = filter.aggregateField(mergedGames, 'penalty_kill_chances');
    const cards = [
      card('Power-play %', pp.rate === null ? null : pct(pp.rate), `${pp.count} of ${mergedGames.length} games recorded`),
      card('Penalty-kill %', pk.rate === null ? null : pct(pk.rate), `${pk.count} of ${mergedGames.length} games recorded`),
      card('PP opportunities', ppChances.sum, `${ppChances.count} of ${mergedGames.length} games recorded`),
      card('Times shorthanded', pkChances.sum, `${pkChances.count} of ${mergedGames.length} games recorded`)
    ].join('');
    return `<div class="grid stat-grid">${cards}</div>
      <div class="analytics-chart-block"><h3>Power-play trend</h3>${pctBarChart(filter, mergedGames, 'power_play_success', 'power_play_chances', 'Power play')}</div>
      <div class="analytics-chart-block"><h3>Penalty-kill trend</h3>${pctBarChart(filter, mergedGames, 'penalty_kill_success', 'penalty_kill_chances', 'Penalty kill')}</div>`;
  }

  const PERIODS = Object.freeze([['p1', 'P1'], ['p2', 'P2'], ['p3', 'P3'], ['ot', 'OT']]);

  function periodBarChart(rows, forKey, againstKey, label) {
    const values = rows.flatMap(row => [row[forKey].sum, row[againstKey].sum]).filter(value => value !== null);
    if (!values.length) return `<p class="sub">No recorded period ${esc(label.toLowerCase())} data for this selection.</p>`;
    const max = Math.max(...values, 1);
    const bars = rows.map(row => {
      const forAgg = row[forKey];
      const againstAgg = row[againstKey];
      const forBar = forAgg.count ? `<i class="bar-for" style="height:${Math.max(4, (forAgg.sum / max) * 100)}%" title="For: ${forAgg.sum}"></i>` : '<i class="bar-missing" title="Not recorded"></i>';
      const againstBar = againstAgg.count ? `<i class="bar-against" style="height:${Math.max(4, (againstAgg.sum / max) * 100)}%" title="Against: ${againstAgg.sum}"></i>` : '<i class="bar-missing" title="Not recorded"></i>';
      return `<div class="bar-col dual"><span class="bar-pair">${forBar}${againstBar}</span><b>${esc(row.label)}</b></div>`;
    }).join('');
    return `<div class="analytics-bar-chart dual-bar-chart" role="img" aria-label="${esc(label)} by period">${bars}</div><p class="chart-legend"><span class="legend-dot for"></span>For<span class="legend-dot against"></span>Against</p>`;
  }

  function periods(filter, mergedGames) {
    const rows = PERIODS.map(([suffix, label]) => {
      const goalPair = pairedAggregate(filter, mergedGames, `goals_for_${suffix}`, `goals_against_${suffix}`);
      const shotPair = pairedAggregate(filter, mergedGames, `shots_for_${suffix}`, `shots_against_${suffix}`);
      const gf = filter.aggregateField(mergedGames, `goals_for_${suffix}`);
      const ga = filter.aggregateField(mergedGames, `goals_against_${suffix}`);
      const sf = filter.aggregateField(mergedGames, `shots_for_${suffix}`);
      const sa = filter.aggregateField(mergedGames, `shots_against_${suffix}`);
      const goalDiff = goalPair.count ? goalPair.sumA - goalPair.sumB : null;
      const shotDiff = shotPair.count ? shotPair.sumA - shotPair.sumB : null;
      return { label, gf, ga, sf, sa, goalDiff, shotDiff };
    });
    return `<p class="sub">OT applicability is not inferred: a game without a recorded OT period is treated as missing, never as zero. Each total uses its recorded observations; differentials use only games with both values recorded.</p>
      <div class="analytics-chart-block"><h3>Goals by period</h3>${periodBarChart(rows, 'gf', 'ga', 'Goals')}</div>
      <div class="analytics-chart-block"><h3>Shots by period</h3>${periodBarChart(rows, 'sf', 'sa', 'Shots')}</div>
      ${table(['Period', 'GF', 'GA', 'Goal diff', 'SF', 'SA', 'Shot diff'], rows.map(row => `<tr><td>${esc(row.label)}</td><td>${display(row.gf.sum)}</td><td>${display(row.ga.sum)}</td><td>${signed(row.goalDiff)}</td><td>${display(row.sf.sum)}</td><td>${display(row.sa.sum)}</td><td>${signed(row.shotDiff)}</td></tr>`))}`;
  }

  function playerLink(player) {
    return `<button type="button" class="analytics-player-link" data-analytics-player-link="${esc(player.source_player_id)}">#${esc(player.jersey_number)} ${esc(player.name)}</button>`;
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
      // Points must only combine goals+assists from games where BOTH were
      // actually recorded together (spec §2) -- a game recording goals but
      // missing assists (or vice versa) must not have the missing side
      // silently coerced to 0 and folded into the total.
      const goalsAssists = pairedAggregate(filter, playerRows, 'goals', 'assists');
      const points = goalsAssists.count ? goalsAssists.sumA + goalsAssists.sumB : null;
      return `<tr><td>${player.source_player_id ? playerLink(player) : `#${esc(player.jersey_number)} ${esc(player.name)}`}</td><td>${display(gp.sum)}</td><td>${display(goals.sum)}</td><td>${display(assists.sum)}</td><td>${display(points)}</td><td>${display(shots.sum)}</td><td>${display(plusMinus.sum)}</td></tr>`;
    });
    return table(['Player', 'GP', 'G', 'A', 'PTS', 'SOG', '+/-'], rows, 'No skater records are available for this selection.');
  }

  // Save% and GAA require values recorded together per game (Blocker 5):
  // summing saves and goals-against independently, then combining, would
  // silently mismatch denominators whenever one field is recorded in games
  // the other is not. Both use pairedAggregate so only games with the full
  // required pair contribute.
  function goalieSavePct(filter, playerRows) {
    const paired = pairedAggregate(filter, playerRows, 'saves', 'goals_against');
    if (!paired.count) return { display: '—', saves: null, ga: null, shotsAgainst: null, recordedGames: 0 };
    const shotsAgainst = paired.sumA + paired.sumB;
    const rate = shotsAgainst > 0 ? (paired.sumA / shotsAgainst) * 100 : null;
    return { display: rate === null ? '—' : `${rate.toFixed(1)}%`, saves: paired.sumA, ga: paired.sumB, shotsAgainst, recordedGames: paired.count };
  }

  function goalieGAA(filter, playerRows) {
    // No zero-minute denominator, and missing minutes are never assumed to
    // be a full game -- a game only counts if minutes were actually logged.
    const paired = pairedAggregate(filter, playerRows, 'goals_against', 'minutes');
    if (!paired.count || !paired.sumB) return { display: '—', recordedGames: paired.count };
    return { display: (paired.sumA / (paired.sumB / 60)).toFixed(2), recordedGames: paired.count };
  }

  function goalies(filter, roster, playerStats, gameIds) {
    const idSet = new Set(gameIds);
    const rows = (roster || []).filter(player => String(player.player_type || '').toLowerCase() === 'goalie' || String(player.position || '').toUpperCase() === 'G').map(player => {
      const playerRows = (playerStats || []).filter(row => row.source_player_id === player.source_player_id && row.player_type === 'goalie' && idSet.has(row.source_game_id));
      const gp = filter.aggregateField(playerRows, 'gp');
      const save = goalieSavePct(filter, playerRows);
      const gaa = goalieGAA(filter, playerRows);
      return `<tr><td>${player.source_player_id ? playerLink(player) : `#${esc(player.jersey_number)} ${esc(player.name)}`}</td><td>${display(gp.sum)}</td><td>${display(save.saves)}</td><td>${display(save.ga)}</td><td>${display(save.shotsAgainst)}</td><td>${save.display}</td><td>${gaa.display}</td><td>${save.recordedGames} of ${playerRows.length} recorded</td></tr>`;
    });
    return table(['Goalie', 'GP', 'Saves', 'GA', 'SA', 'SV%', 'GAA', 'Sample'], rows, 'No goalie records are available for this selection.');
  }

  function games(mergedGames) {
    return table(['Date', 'Opponent', 'Game type', 'Game Center'], mergedGames.map(game => `<tr><td>${esc(date(game.date))}</td><td>${esc(game.opponent || '—')}</td><td>${display(game.game_type)}</td><td>${game.source_game_id ? `<button type="button" class="analytics-game-link" data-analytics-game-link="${esc(game.source_game_id)}">Open Game Center</button>` : '—'}</td></tr>`), 'No games are available for this season.');
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
    return `<div class="page-head"><div><div class="eyebrow">PUCKNEXUS · ${esc(data.teamName || 'Selected team')} workspace</div><h1>${esc(label)}</h1><p>Analytics from recorded team, player, and goalie game data.</p></div></div><nav class="workspace-tabs analytics-tabs" aria-label="Analytics tabs">${TABS.map(([id, name]) => `<button type="button" data-analytics-tab="${id}" aria-pressed="${id === tab}" class="${id === tab ? 'active' : ''}">${name}</button>`).join('')}</nav><section class="card analytics-content">${body}</section>`;
  }

  root.FoxesAnalyticsUI = Object.freeze({ TABS, render });
})(globalThis);
