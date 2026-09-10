const { PERMISSIONS, STAFF, can } = window.FoxesPermissions;
const { PLATFORM, applyDocumentBrand } = window.FoxesPlatformBranding;
const app = document.querySelector('#app');
const nav = document.querySelectorAll('.nav-item');
const authScreen = document.querySelector('#authScreen');
const appShell = document.querySelector('#appShell');
const supabaseClient = window.supabase.createClient(
  'https://yshbvrumzusmwlprfcnr.supabase.co',
  'sb_publishable_PFK2d1or62DYpk3VxarJwA_Anazyv7D'
);
const INVITE_FUNCTION = 'invite-staff';
let activeStaff = null;
let authUser = null;
let authTeam = null;
let authCapabilities = [];
let recoveryMode = false;
let workspaceTransitioning = false;
let intentionalSignOut = false;
let sessionNotice = '';
let currentDestination = '';
let phase1Data = null;
let phase1DataError = '';
let phase2AData = null;
let phase2ADataError = '';
const teamContextManager = window.FoxesTeamContext.createTeamContext({ client: supabaseClient });
const seasonContextManager = window.FoxesSeasonContext.createSeasonContext({ client: supabaseClient });
const platformAccessManager = window.FoxesPlatformAccess.createPlatformAccess({ client: supabaseClient });
const { DESTINATIONS, resolveDestination } = window.FoxesDestinationResolver;
const teamContext = teamContextManager.context;
const seasonContext = seasonContextManager.context;
const platformAccess = platformAccessManager.context;
const platformAdminManager = window.FoxesPlatformAdmin.createPlatformAdmin({
  client: supabaseClient,
  platformAccess,
  branding: PLATFORM
});
let onboardingManager = null;
applyDocumentBrand();
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const queryParams = new URLSearchParams(location.search);
let pendingInviteToken = queryParams.get('invite_token') || '';
if (pendingInviteToken) {
  const cleanUrl = new URL(location.href);
  const cleanParams = new URLSearchParams(
    [...cleanUrl.searchParams].filter(([key]) => key !== 'invite_token')
  );
  cleanUrl.search = cleanParams.toString();
  window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}
const authCallbackPresent = ['access_token', 'refresh_token', 'type', 'code', 'error', 'error_code']
  .some(key => hashParams.has(key) || queryParams.has(key));
const recoveryCallbackPresent = hashParams.get('type') === 'recovery'
  || queryParams.get('type') === 'recovery';
// Development-only preview. Requires an explicit loopback host AND the flag;
// it cannot activate on any production hostname and grants no backend access
// (RLS still authorizes every query — prototype data is empty).
const prototypeHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
const prototypeMode = prototypeHost
  && !authCallbackPresent
  && queryParams.get('prototype') === '1';

const viewNames = { command: 'Command Center', schedule: 'Schedule', stats: 'Team Stats', players: 'Player Profiles', games: 'Game Center', scouting: 'Scouting', reports: 'Coach Reports', development: 'Player Development', admin: 'Admin', settings: 'Settings' };
const roleViews = { command: PERMISSIONS.DASHBOARD_VIEW, schedule: PERMISSIONS.SCHEDULE_VIEW, stats: PERMISSIONS.STATS_VIEW, players: PERMISSIONS.PLAYERS_VIEW, games: PERMISSIONS.GAMES_VIEW, scouting: PERMISSIONS.SCOUTING_VIEW, reports: PERMISSIONS.REPORTS_VIEW, development: PERMISSIONS.PLAYERS_VIEW, admin: PERMISSIONS.ADMIN_USERS, settings: PERMISSIONS.DASHBOARD_VIEW };

// The trailing text is a descriptive note, not a destination. It previously
// rendered as an empty-hash anchor, whose default navigation jumped the page
// to the top on every click.
function cardTitle(title, link = '') { return `<div class="card-title"><h2>${title}</h2>${link ? `<span class="card-note">${link}</span>` : ''}</div>`; }
function tenantName() { return seasonContext.branding?.display_name || authTeam?.teams?.name || 'Selected team'; }
function tenantSeasonName() { return seasonContext.selectedSeason?.name || phase1Data?.seasonRecord?.season_key || 'Live season'; }
function shell(title, subtitle, body) { return `<div class="page-head"><div><div class="eyebrow">${PLATFORM.name} · ${escapeHtml(tenantName())} workspace</div><h1>${title}</h1><p>${subtitle}</p></div></div>${body}`; }
function notice(text) { return `<div class="callout prototype-note">${text}</div>`; }
function phase1Number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function phase1Date(value) { return value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : 'Date unavailable'; }
function phase1Record() { return phase1Data?.seasonRecord || { games_played: 0, wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 }; }
function playerStatTotals() {
  const totals = new Map();
  (phase1Data?.playerStats || []).forEach(row => {
    const current = totals.get(row.source_player_id) || { goals: 0, assists: 0, plus_minus: 0, games: 0 };
    current.goals += phase1Number(row.goals);
    current.assists += phase1Number(row.assists);
    current.plus_minus += phase1Number(row.plus_minus);
    current.games += phase1Number(row.gp);
    totals.set(row.source_player_id, current);
  });
  return totals;
}
const coachQol = window.FoxesCoachQol.createCoachQol({
  client: supabaseClient,
  getContext: () => ({
    teamId: authTeam?.team_id || '',
    seasonId: seasonContext.selectedSeasonId || '',
    seasonKey: seasonContext.selectedSeason?.season_key || '',
    capabilities: authCapabilities,
    schedule: phase1Data?.schedule || [],
    roster: phase1Data?.roster || []
  }),
  onChanged: () => {
    // Returned so callers can await the reload; this is what makes UI
    // restoration deterministic instead of timer-based.
    if (authTeam?.team_id) return loadPhase1Data(authTeam.team_id);
    return Promise.resolve();
  }
});
const D = window.FoxesDashboard;
let dashboardLeaderCategory = 'points';
let dashboardTrendWindow = 'season';
// Tracks the last painted view so a same-view rerender (leader tabs, trend
// window, data refresh) keeps the reader's scroll position instead of
// snapping the page back to the top.
let lastRenderedView = '';

function helpBubble(text) {
  return `<button class="help-bubble" type="button" aria-label="Help" data-help="${escapeHtml(text)}">?</button>`;
}

function sparkline(points, label) {
  const values = points.filter(p => p.value !== null && p.value !== undefined).map(p => Number(p.value));
  if (values.length < 2) return '<span class="sub">Not enough completed games for a trend yet.</span>';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, index) => `${4 + index * (102 / Math.max(1, values.length - 1))},${26 - ((value - min) / span) * 22}`).join(' ');
  return `<svg class="sparkline" viewBox="0 0 110 30" role="img" aria-label="${escapeHtml(label)}"><polyline points="${coords}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

function command() {
  const roster = phase1Data?.roster || [];
  const scheduleData = phase1Data?.schedule || [];
  const games = phase1Data?.games || [];
  const playerStats = phase1Data?.playerStats || [];
  const teamStats = phase1Data?.teamStats || [];
  const teamStatsByGame = new Map(teamStats.map(row => [row.source_game_id, row]));
  const snap = D.snapshot(games, teamStatsByGame, phase1Data?.seasonRecord);
  const stateInfo = D.dashboardState({ roster, schedule: scheduleData, games, playerStats, teamStats, seasonRecord: phase1Data?.seasonRecord });
  const recent = D.recentGames(games, teamStatsByGame, 5);
  const next = D.upcomingGame(scheduleData);
  const last5 = D.lastFive(games, teamStatsByGame);
  const rows = D.playerTotals(roster, playerStats);
  const goalies = D.goalieTotals(roster, playerStats);
  const gamesOrder = new Map(games.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).map((game, index) => [game.source_game_id, index]));
  const canEditStats = can(PERMISSIONS.STATS_EDIT, activeStaff);
  const canEditSchedule = can(PERMISSIONS.SCHEDULE_EDIT, activeStaff);
  const canEditRoster = can(PERMISSIONS.PLAYERS_EVALUATE, activeStaff);

  if (stateInfo.emptyKind) {
    const content = {
      no_roster: ['Add your roster to begin tracking players.', 'Player leaders, trends, and stat entry all start from the roster.', canEditRoster ? 'players' : '', 'Manage Roster'],
      no_games: ['Your season is ready. Add your first game to start building team trends.', 'Schedule entries and completed games drive the dashboard.', canEditSchedule ? 'schedule' : '', 'Add Game'],
      no_stats: ['You have games on the schedule, but no stats have been entered yet.', 'Enter stats for a completed game to unlock leaders, goalies, and trends.', canEditStats ? 'games' : '', 'Enter Stats']
    }[stateInfo.emptyKind];
    return shell('Team Dashboard', `Live picture for ${escapeHtml(tenantName())} · ${escapeHtml(tenantSeasonName())}.`, `
      ${next ? `<section class="card next-game">${cardTitle('NEXT GAME', 'Schedule')}<div class="game-top"><div class="opponent"><div class="opponent-mark">${escapeHtml(String(next.opponent || 'AF').slice(0, 2).toUpperCase())}</div><div><p>${phase1Date(next.date)} · ${escapeHtml(next.home_away)}</p><h2>${escapeHtml(next.opponent)}</h2><p>${escapeHtml(next.location || 'Location unavailable')}${next.time ? ` · ${escapeHtml(next.time)}` : ''}</p></div></div></div></section>` : ''}
      <section class="card empty-view"><div class="empty-icon">⌂</div><h2>${content[0]}</h2><p>${content[1]}</p>${content[2] ? `<button class="btn primary" type="button" data-dashboard-goto="${content[2]}">${content[3]}</button>` : ''}</section>`);
  }

  const leadersFor = D.leaders(rows, dashboardLeaderCategory, 5);
  const trendPoints = D.teamTrendSeries(games, teamStatsByGame, 'goalsFor', dashboardTrendWindow).points;
  const comparison = D.compareToAverage(games, teamStatsByGame);
  const forms = D.recentForm(rows, games, 5).sort((a, b) => b.total - a.total).slice(0, 5);

  const quickActions = [
    canEditSchedule ? ['schedule', 'Add Game'] : null,
    canEditStats ? ['games', 'Enter Stats'] : null,
    canEditRoster ? ['players', 'Manage Roster'] : null,
    ['schedule', 'View Schedule']
  ].filter(Boolean);

  return shell(`How are we doing?`, `${escapeHtml(tenantName())} · ${escapeHtml(tenantSeasonName())} — derived from real synced data only.`, `
    ${next ? `<section class="card next-game">${cardTitle('NEXT GAME', 'Schedule')}<div class="game-top"><div class="opponent"><div class="opponent-mark">${escapeHtml(String(next.opponent || 'AF').slice(0, 2).toUpperCase())}</div><div><p>${phase1Date(next.date)} · ${escapeHtml(next.home_away)}</p><h2>${escapeHtml(next.opponent)}</h2><p>${escapeHtml(next.location || 'Location unavailable')}${next.time ? ` · ${escapeHtml(next.time)}` : ''}</p></div></div><span class="home-pill">${escapeHtml(next.home_away)}</span></div></section>` : ''}

    <div class="grid stat-grid">
      ${[['Record', snap.hasRecord ? `${snap.w}–${snap.l}–${snap.t}` : '—', `${snap.gp} games played`],
        ['Last 5', last5.count >= 3 ? `${last5.w}–${last5.l}–${last5.t}` : '—', last5.count ? `${last5.count} scored game${last5.count === 1 ? '' : 's'}` : 'No scored games yet'],
        ['Goals For / Against', snap.hasRecord ? `${snap.gf} / ${snap.ga}` : '—', `Differential ${snap.diff > 0 ? '+' : ''}${snap.diff}`],
        ['Shooting %', snap.shootingPct === null ? '—' : `${(snap.shootingPct * 100).toFixed(1)}%`, `${snap.shots} shots on goal`]]
        .map(x => `<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}
    </div>

    <div class="grid split">
      <section class="card recent">${cardTitle('RECENT GAMES', 'Game Center')}${recent.length ? recent.map(game => `<div class="game-row"><div><strong>${escapeHtml(game.opponent)}</strong><small>${phase1Date(game.date)}</small></div><span class="score">${escapeHtml(game.score)}</span><span class="result ${game.result === 'W' ? 'win' : game.result === 'L' ? 'loss' : ''}">${game.result === 'W' ? 'WIN' : game.result === 'L' ? 'LOSS' : 'TIE'}</span></div>`).join('') : '<p class="sub">No completed games with scores yet.</p>'}<div class="dash-actions"><button class="btn" type="button" data-dashboard-goto="schedule">View Full Schedule</button></div></section>

      <section class="card">${cardTitle('PLAYER LEADERS', 'Player Profiles')}
        <div class="leader-tabs">${Object.entries(D.LEADER_CATEGORIES).filter(([key]) => ['goals', 'assists', 'points', 'shots', 'blocks', 'plusMinus', 'faceoffPct'].includes(key)).map(([key, config]) => `<button class="leader-tab${dashboardLeaderCategory === key ? ' active' : ''}" type="button" data-leader-cat="${key}">${escapeHtml(config.label)}</button>`).join('')}</div>
        ${D.LEADER_CATEGORIES[dashboardLeaderCategory]?.note ? `<p class="sub">${escapeHtml(D.LEADER_CATEGORIES[dashboardLeaderCategory].note)}</p>` : ''}
        ${leadersFor.length ? leadersFor.map(entry => {
          const row = rows.find(r => r.player.source_player_id === entry.player.source_player_id);
          const trend = row ? D.trendFor(row.byGame, gamesOrder) : null;
          const arrow = trend === 'improving' ? '<span class="trend-arrow up" title="Last 3 games outscore the previous 3">↑</span>' : trend === 'declining' ? '<span class="trend-arrow down" title="Last 3 games below the previous 3">↓</span>' : trend === 'stable' ? '<span class="trend-arrow" title="Last 3 games even with the previous 3">→</span>' : '';
          return `<div class="leader"><span class="leader-rank">${entry.rank}</span><span class="jersey">#${escapeHtml(entry.player.jersey_number)}</span><div><strong>${escapeHtml(entry.player.name)}</strong><small>${arrow}</small></div><span class="leader-value">${escapeHtml(entry.display)}</span></div>`;
        }).join('') : `<p class="sub">No ${escapeHtml(D.LEADER_CATEGORIES[dashboardLeaderCategory]?.label || '')} recorded yet.</p>`}
        ${forms.length ? `<div class="recent-form"><span class="sub">Recent form (points, last 5):</span> ${forms.map(entry => `<span class="form-chip" title="${escapeHtml(entry.player.name)}">${escapeHtml(entry.player.name.split(' ').pop())} ${entry.form.map(points => `${points}P`).join(' · ')}</span>`).join('')}</div>` : ''}
      </section>
    </div>

    <div class="grid split">
      <section class="card">${cardTitle('GOALIE SNAPSHOT', 'Player Profiles')}
        ${goalies.length ? goalies.map(goalie => `<div class="goalie-row"><span class="jersey">#${escapeHtml(goalie.player.jersey_number)}</span><div><strong>${escapeHtml(goalie.player.name)}</strong><small>${goalie.gp} GP · ${goalie.w}–${goalie.l}–${goalie.t}${goalie.so ? ` · ${goalie.so} SO` : ''}</small></div><span class="leader-value">${goalie.savePct === null ? '—' : `${(goalie.savePct * 100).toFixed(1)}%`} <small>SV%</small></span><small class="sub">${goalie.saves} saves · ${goalie.shotsAgainst} SA</small></div>`).join('') : '<p class="sub">No goalies on the roster yet. Mark a player as Goalie (G) to see goalie stats here.</p>'}
        <p class="sub">Save % = Saves / (Saves + GA). GAA is not shown because per-game minutes are not reliably tracked.</p>
      </section>

      <section class="card">${cardTitle('TEAM TRENDS', '')}
        <div class="leader-tabs">${[['season', 'Season'], ['10', 'Last 10'], ['5', 'Last 5']].map(([key, label]) => `<button class="leader-tab${dashboardTrendWindow === key ? ' active' : ''}" type="button" data-trend-window="${key}">${label}</button>`).join('')}</div>
        <div class="trend-chart">${sparkline(trendPoints, `Goals for by game (${dashboardTrendWindow})`)}<span class="sub">Goals for by game ${helpBubble('Completed, scored games only. Missing or unscored games are skipped.')}</span></div>
        ${comparison ? `<div class="trend-compare"><strong>Goals/Game</strong> Season ${comparison.season.toFixed(1)} · Last ${comparison.sample} ${comparison.recent.toFixed(1)} ${comparison.direction === 'up' ? '<span class="trend-arrow up">↑</span>' : comparison.direction === 'down' ? '<span class="trend-arrow down">↓</span>' : '<span class="trend-arrow">→</span>'}</div>` : '<p class="sub">Trends appear once completed games have scores.</p>'}
        <p class="sub">Faceoff % by game is available where faceoff stats exist; PIM-by-game is not yet supported by synced team stats and is intentionally omitted.</p>
      </section>
    </div>

    <section class="card">${cardTitle('QUICK ACTIONS', '')}<div class="dash-actions">${quickActions.map(([view, label]) => `<button class="btn${label === 'Add Game' ? ' primary' : ''}" type="button" data-dashboard-goto="${view}">${label}</button>`).join('')}</div></section>`);
}

function bindDashboardControls() {
  document.querySelectorAll('[data-dashboard-goto]').forEach(button => button.addEventListener('click', () => render(button.dataset.dashboardGoto)));
  document.querySelectorAll('[data-leader-cat]').forEach(button => button.addEventListener('click', () => { dashboardLeaderCategory = button.dataset.leaderCat; render('command'); }));
  document.querySelectorAll('[data-trend-window]').forEach(button => button.addEventListener('click', () => { dashboardTrendWindow = button.dataset.trendWindow; render('command'); }));
}
function schedule() {
  const canEdit = can(PERMISSIONS.SCHEDULE_EDIT, activeStaff);
  const today = new Date().toISOString().slice(0, 10);
  const games = (phase1Data?.schedule || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const upcoming = games.filter(g => String(g.date) >= today);
  const past = games.filter(g => String(g.date) < today);
  const row = game => `<div class="schedule-item${String(game.date) < today ? ' past' : ''}"><div class="schedule-date"><strong>${escapeHtml(new Date(`${game.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit' }).toUpperCase())}</strong>${escapeHtml(String(game.date).slice(0, 4))}</div><div><h3>${escapeHtml(game.opponent)}</h3><p>${escapeHtml(game.home_away)} · ${escapeHtml(game.location || 'Location unavailable')}${game.time ? ` · ${escapeHtml(game.time)}` : ''}</p></div><span class="tag">${escapeHtml(game.game_type)}</span>${canEdit ? `<span class="schedule-actions"><button class="btn admin-action" type="button" data-coach-edit-game="${escapeHtml(game.id)}">Edit</button><button class="btn admin-action danger" type="button" data-coach-delete-game="${escapeHtml(game.id)}">Delete</button></span>` : ''}</div>`;
  return shell('Schedule', canEdit ? 'Add and manage games. Changes save to the team immediately.' : 'Live schedule synced from the team Windows app.', `
    ${canEdit ? `<section class="card"><div class="card-title"><h2>${phase1Data?.schedule?.some(() => true) ? 'Add game' : 'Add your first game'}</h2><span class="admin-security-note">Team-scoped · RLS enforced</span></div><div id="coachGameFormHost">${coachQol.gameFormHtml()}</div></section>` : ''}
    ${games.length ? `<section class="card">${cardTitle(`Upcoming · ${upcoming.length}`, 'Newest changes save instantly')}<div class="schedule-list">${upcoming.map(row).join('') || '<div class="empty-view"><p>No upcoming games.</p></div>'}</div></section>
    <section class="card">${cardTitle(`Completed · ${past.length}`, '')}<div class="schedule-list">${past.map(row).join('') || '<div class="empty-view"><p>No completed games yet.</p></div>'}</div></section>`
    : `<section class="card empty-view"><div class="empty-icon">◷</div><h2>No games yet</h2><p>Add your first game to start tracking your season.</p>${canEdit ? '' : '<p>Schedule editing requires the schedule.edit capability.</p>'}</div></section>`}`);
}

function bindCoachGameControls() {
  const host = document.querySelector('#coachGameFormHost');
  coachQol.enhanceDateInputs(host);
  host?.querySelector('[data-game-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    coachQol.submitGameForm(event.currentTarget);
  });
  document.querySelectorAll('[data-coach-edit-game]').forEach(button => button.addEventListener('click', () => {
    const game = (phase1Data?.schedule || []).find(g => g.id === button.dataset.coachEditGame);
    if (!game || !host) return;
    host.innerHTML = coachQol.gameFormHtml(game);
    coachQol.enhanceDateInputs(host);
    host.querySelector('[data-game-form]').addEventListener('submit', event => {
      event.preventDefault();
      coachQol.submitGameForm(event.currentTarget);
    });
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-coach-delete-game]').forEach(button => button.addEventListener('click', async () => {
    const game = (phase1Data?.schedule || []).find(g => g.id === button.dataset.coachDeleteGame);
    if (!game) return;
    const linkedStats = (phase1Data?.games || []).some(g => g.date === game.date && String(g.opponent).toLowerCase() === String(game.opponent).toLowerCase());
    const warning = linkedStats
      ? `Delete the ${game.date} game vs ${game.opponent}? A synced game with stats exists for this date/opponent — the stats record is kept, only the schedule entry is removed.`
      : `Delete the ${game.date} game vs ${game.opponent}?`;
    if (!window.confirm(warning)) return;
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
      await coachQol.deleteGame(game.id);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Delete';
      window.alert(error.message || 'The game could not be deleted.');
    }
  }));
}
function stats() { const edit = can(PERMISSIONS.STATS_EDIT_OFFICIAL, activeStaff); const record = phase1Record(); const teamStats = phase1Data?.teamStats || []; const totals = teamStats.reduce((sum, row) => ({ shots: sum.shots + phase1Number(row.shots_for), pp: sum.pp + phase1Number(row.power_play_success), ppChances: sum.ppChances + phase1Number(row.power_play_chances), foW: sum.foW + phase1Number(row.faceoff_wins), foL: sum.foL + phase1Number(row.faceoff_losses) }), { shots: 0, pp: 0, ppChances: 0, foW: 0, foL: 0 }); return shell('Team Stats','Read-only statistics from the synced team game data.',`<div class="grid stat-grid">${[['RECORD',`${record.wins}–${record.losses}–${record.ties}`,`${record.games_played} games`],['SHOTS / GAME',(totals.shots / Math.max(teamStats.length,1)).toFixed(1),'From team game stats'],['FACE-OFFS',`${((totals.foW / Math.max(totals.foW + totals.foL,1)) * 100).toFixed(1)}%`,'From team game stats'],['PLAYER-STAT ROWS',String(phase1Data?.playerStats?.length || 0),'Synced player-stat rows']].map(x=>`<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}</div><section class="card">${cardTitle('Season overview','Supabase read-only')}${edit ? '<span class="permission-lock">Official stat editing remains disabled in this web read-only phase.</span>' : '<span class="permission-lock">Statistics are read-only for this phase.</span>'}<div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th><th>Total</th><th>Average / rate</th></tr></thead><tbody>${[['Goals for',record.goals_for, (record.goals_for / Math.max(record.games_played,1)).toFixed(2)],['Goals against',record.goals_against,(record.goals_against / Math.max(record.games_played,1)).toFixed(2)],['Shots on goal',totals.shots,(totals.shots / Math.max(teamStats.length,1)).toFixed(1)],['Power-play successes',totals.pp,`${totals.ppChances ? ((totals.pp / totals.ppChances) * 100).toFixed(1) : '0.0'}%`],['Face-off wins',totals.foW,`${((totals.foW / Math.max(totals.foW + totals.foL,1)) * 100).toFixed(1)}%`]].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div></section>`); }
function players() {
  const totals = playerStatTotals();
  const canEditRoster = can(PERMISSIONS.PLAYERS_EVALUATE, activeStaff);
  return shell('Player Profiles', canEditRoster ? 'Quick add, edit, and manage your roster.' : 'Live roster and basic player stats from Supabase.', `
    ${canEditRoster ? `<section class="card"><div class="card-title"><h2>Roster management</h2><span class="admin-security-note">Team-scoped · RLS enforced</span></div><div id="coachRosterHost">${coachQol.rosterWorkspaceHtml(phase1Data?.roster || [])}</div></section>` : ''}
    <section class="card">${cardTitle(`Roster · ${phase1Data?.roster?.length || 0} players`, 'Supabase live data')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Position</th><th>Games</th><th>Goals</th><th>Points</th><th>+ / −</th><th>Status</th></tr></thead><tbody>${(phase1Data?.roster || []).map(player => { const stat = totals.get(player.source_player_id) || {}; return `<tr><td><div class="player-cell"><span class="player-photo">${escapeHtml(player.jersey_number)}</span><strong>${escapeHtml(player.name)}</strong></div></td><td class="role">${escapeHtml(player.position)}</td><td>${phase1Number(stat.games)}</td><td>${phase1Number(stat.goals)}</td><td>${phase1Number(stat.goals) + phase1Number(stat.assists)}</td><td class="trend-up">${phase1Number(stat.plus_minus)}</td><td><span class="tag">${canEditRoster ? 'Editable' : 'View only'}</span></td></tr>`; }).join('') || `<tr><td colspan="7">${canEditRoster ? 'Your roster is empty. Add players above before entering game stats.' : 'No roster data is available.'}</td></tr>`}</tbody></table></div></section>`);
}

function bindCoachRosterControls() {
  const host = document.querySelector('#coachRosterHost');
  host?.querySelector('[data-player-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    coachQol.submitPlayerForm(event.currentTarget);
  });
  // Roster edit: mount the edit form in place of the quick-add form, save
  // through the existing editPlayer() path, then restore the workspace.
  host?.querySelectorAll('[data-edit-player]').forEach(button => button.addEventListener('click', () => {
    const player = (phase1Data?.roster || []).find(p => p.id === button.dataset.editPlayer);
    if (!player || !host) return;
    const restore = () => {
      host.innerHTML = coachQol.rosterWorkspaceHtml(phase1Data?.roster || []);
      bindCoachRosterControls();
    };
    host.innerHTML = `<div class="card-title"><h2>Edit #${escapeHtml(player.jersey_number)} ${escapeHtml(player.name)}</h2></div>${coachQol.playerEditFormHtml(player)}`;
    host.querySelector('[data-cancel-player-edit]')?.addEventListener('click', restore);
    host.querySelector('[data-player-edit-form]')?.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        // submitPlayerEditForm awaits editPlayer, which awaits onChanged, which
        // is the reload + repaint. When this resolves the roster is genuinely
        // fresh, so restoration is deterministic rather than timer-based.
        await coachQol.submitPlayerEditForm(event.currentTarget);
        // If render() already replaced this host the view is correct; only
        // restore when the node we mounted into is still attached.
        if (document.body.contains(host)) restore();
      } catch (error) {
        // The form already shows the failure and keeps the coach's edits.
      }
    });
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  host?.querySelectorAll('[data-remove-player]').forEach(button => button.addEventListener('click', async () => {
    const player = (phase1Data?.roster || []).find(p => p.id === button.dataset.removePlayer);
    if (!player) return;
    const hasStats = (phase1Data?.playerStats || []).some(s => s.source_player_id === player.source_player_id);
    const warning = hasStats
      ? `Remove #${player.jersey_number} ${player.name} from the roster? They have recorded game stats — those stat rows are kept for season history, but the player leaves the active roster.`
      : `Remove #${player.jersey_number} ${player.name} from the roster?`;
    if (!window.confirm(warning)) return;
    button.disabled = true;
    button.textContent = 'Removing…';
    try {
      await coachQol.removePlayer(player.id);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Remove';
      window.alert(error.message || 'The player could not be removed.');
    }
  }));
}
function gameCenter() {
  const teamStats = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  const playerStats = new Map();
  (phase1Data?.playerStats || []).forEach(row => playerStats.set(row.source_game_id, (playerStats.get(row.source_game_id) || 0) + 1));
  const games = (phase1Data?.games || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const canEditStats = can(PERMISSIONS.STATS_EDIT, activeStaff);
  // A game counts as played only when it carries a team-stats row. Eager
  // shells created by Schedule Add therefore appear here immediately without
  // ever being counted as completed, and a future-dated shell is not yet
  // eligible for stat entry (save_game_stats enforces the same date rule).
  const today = new Date().toLocaleDateString('en-CA');
  const isPlayed = game => teamStats.has(game.source_game_id);
  const playedCount = games.filter(isPlayed).length;
  const cards = games.map(game => {
    const stats = teamStats.get(game.source_game_id);
    const hasScore = stats && (stats.goals_for !== null || stats.goals_against !== null);
    const eligible = String(game.date) <= today;
    const score = hasScore ? `${phase1Number(stats.goals_for)}–${phase1Number(stats.goals_against)}` : eligible ? 'Score unavailable' : 'Not yet played';
    const result = hasScore ? (stats.goals_for > stats.goals_against ? 'WIN' : stats.goals_for < stats.goals_against ? 'LOSS' : 'TIE') : eligible ? 'NOT SCORED' : 'SCHEDULED';
    return `<article class="card game-card"><div class="game-card-head"><div><span class="eyebrow">${escapeHtml(phase1Date(game.date))}</span><h2>${escapeHtml(game.opponent || 'Opponent unavailable')}</h2><p>${escapeHtml(game.period_length_min ? `${game.period_length_min}-minute periods` : 'Game details synced from Windows')}</p></div><span class="result ${result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : ''}">${result}</span></div><div class="game-score">${escapeHtml(score)}</div><div class="game-card-meta"><span>${playerStats.get(game.source_game_id) || 0} player-stat rows</span><span>${stats ? `${phase1Number(stats.shots_for)} shots for` : 'Official team stats unavailable'}</span>${canEditStats && eligible ? `<button class="btn" type="button" data-enter-stats="${escapeHtml(game.source_game_id)}">${playerStats.get(game.source_game_id) ? 'Edit Stats' : 'Enter Stats'}</button>` : `<span class="tag">${canEditStats ? 'Not yet playable' : 'Read only'}</span>`}</div></article>`;
  }).join('');
  return shell('Game Center', canEditStats ? 'Enter and correct game stats from one workspace.' : 'Read-only game summaries from the selected team and season.', `
    ${canEditStats ? '<section class="card" id="coachStatsHost" hidden></section>' : ''}
    <div class="callout"><strong>${playedCount} of ${games.length} games played</strong><br>${canEditStats ? 'Choose Enter Stats on a game to open the roster-wide stat entry workspace. One save persists the whole game.' : 'Game Center shows official cloud-backed summaries only. Detailed video, TOI, tracking, and local game workflows remain in the Windows app.'}</div><div class="game-center-grid">${cards || `<section class="card empty-view"><div class="empty-icon">▣</div><h2>No games available</h2><p>${canEditStats ? 'Add a game from the Schedule page, then enter stats here.' : 'No completed games are synced for the selected team and season.'}</p></section>`}</div>`);
}

function bindCoachStatsControls() {
  const host = document.querySelector('#coachStatsHost');
  if (!host) return;
  document.querySelectorAll('[data-enter-stats]').forEach(button => button.addEventListener('click', () => {
    const gameId = button.dataset.enterStats;
    const skaters = (phase1Data?.playerStats || []).filter(s => s.source_game_id === gameId && s.player_type === 'skater');
    const goalies = (phase1Data?.playerStats || []).filter(s => s.source_game_id === gameId && s.player_type === 'goalie');
    coachQol.openGame(gameId, skaters, goalies);
    host.hidden = false;
    host.innerHTML = `<div class="card-title"><h2>Enter stats · ${escapeHtml(gameId)}</h2><button class="btn" type="button" data-close-stats>Close</button></div>${coachQol.statsWorkspaceHtml(phase1Data?.roster || [], skaters, goalies)}`;
    host.querySelector('[data-close-stats]').addEventListener('click', () => {
      if (coachQol.dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
      host.hidden = true;
      host.innerHTML = '';
    });
    host.querySelectorAll('.stat-input').forEach(input => input.addEventListener('input', () => {
      coachQol.setStat(input.dataset.statType, input.dataset.statPlayer, input.dataset.statField, input.value, input.getAttribute('aria-label'));
      const flag = host.querySelector('[data-dirty-flag]');
      if (flag) flag.textContent = 'Unsaved changes';
    }));
    host.querySelector('[data-save-stats]')?.addEventListener('click', async event => {
      const saveButton = event.currentTarget;
      const status = host.querySelector('[data-stats-status]');
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
      status.textContent = '';
      status.className = 'coach-form-status';
      try {
        await coachQol.saveStats();
        saveButton.textContent = '✓ Stats Saved';
        status.textContent = 'Stats saved.';
        status.classList.add('ok');
      } catch (error) {
        saveButton.disabled = false;
        saveButton.textContent = 'Save failed — Retry';
        status.textContent = 'Stats could not be saved — your changes are still on screen. Retry.';
        status.classList.add('err');
      }
    });
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}
function scouting() {
  if (phase2ADataError) return shell('Scouting', 'Read-only opponent identities synced from the Windows app.', `<section class="card empty-view"><div class="empty-icon">!</div><h2>Unable to load opponent data</h2><p>${escapeHtml(phase2ADataError)}</p><button class="btn primary" id="retryPhase2AData" type="button">Retry</button></section>`);
  if (!phase2AData) return shell('Scouting', 'Read-only opponent identities synced from the Windows app.', '<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Loading opponent data</h2><p>Reading verified opponent profiles and players for the selected team.</p></section>');
  const playersByProfile = new Map();
  phase2AData.players.forEach(player => {
    const list = playersByProfile.get(player.opponent_profile_key) || [];
    list.push(player);
    playersByProfile.set(player.opponent_profile_key, list);
  });
  const cards = phase2AData.profiles.map(profile => {
    const players = playersByProfile.get(profile.source_profile_key) || [];
    return `<article class="card opponent-scout-card"><div class="card-title"><h2>${escapeHtml(profile.opponent_name)}</h2><span class="tag">${players.length} player${players.length === 1 ? '' : 's'}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Number</th><th>Position</th><th>Source</th></tr></thead><tbody>${players.map(player => `<tr><td>${escapeHtml(player.player_name || 'Unknown')}</td><td>${escapeHtml(player.jersey_number || 'Unknown')}</td><td>${escapeHtml(player.position || 'Unknown')}</td><td>${escapeHtml(player.source_kind || 'Local source')}</td></tr>`).join('') || '<tr><td colspan="4">No opponent players are recorded for this profile.</td></tr>'}</tbody></table></div></article>`;
  }).join('');
  return shell('Scouting', 'Verified opponent identities only. Private scouting notes and evaluations are not synced in this phase.', `<div class="callout"><strong>${phase2AData.profiles.length} opponent profiles · ${phase2AData.players.length} opponent players</strong><br>Names, jersey numbers, and positions are shown exactly as stored. Missing positions remain Unknown.</div><div class="scouting-grid">${cards || '<section class="card empty-view"><h2>No opponent profiles</h2><p>No verified opponent records are available for this team.</p></section>'}</div>`);
}
function reports() {
  return shell('Coach Reports', 'A read-only workspace shell for future cloud-backed coaching reports.', '<section class="card workspace-shell"><div class="workspace-icon">▤</div><h2>Reports are not synced yet</h2><p>Generated reports remain local to the Windows app until a reviewed cloud report model is available. No placeholder report content is shown here.</p><span class="tag">Windows workflow retained</span></section>');
}
function development() {
  return shell('Player Development', 'A read-only workspace shell for future development records.', '<section class="card workspace-shell"><div class="workspace-icon">↗</div><h2>Development records are not synced yet</h2><p>Private evaluations and development notes remain protected in the Windows app. This web surface will stay empty until an approved, team-scoped cloud model exists.</p><span class="tag">No cloud data available</span></section>');
}
function settings() {
  return shell('Settings', 'Review the selected workspace context and access model.', `<div class="settings-grid"><section class="card settings-card"><div class="card-title"><h2>Workspace context</h2><span class="tag">Read only</span></div><dl class="settings-list"><div><dt>Platform</dt><dd>${escapeHtml(PLATFORM.name)}</dd></div><div><dt>Team</dt><dd>${escapeHtml(tenantName())}</dd></div><div><dt>Season</dt><dd>${escapeHtml(tenantSeasonName())}</dd></div><div><dt>Role</dt><dd>${escapeHtml(activeStaff?.role || 'Authenticated team member')}</dd></div><div><dt>Platform access</dt><dd>${escapeHtml(platformAccess.isPlatformAdmin ? `PuckNexus ${platformAccess.roles.join(' + ') || 'platform_admin'}` : 'Team workspace only')}</dd></div></dl></section><section class="card settings-card"><div class="card-title"><h2>Data policy</h2><span class="tag">Supabase reads</span></div><p class="settings-copy">This browser workspace reads authorized team data through Supabase RLS. Local video, TOI, tracking, vault, backups, and device settings remain in the Windows app.</p><span class="permission-lock">${authCapabilities.length} database-provided capabilities loaded</span></section></div>`);
}
function generic(view) { const titles = { games:['Game Center','One place for game-day details and post-game review.'], reports:['Coach Reports','Turn team observations into clear, shareable reports.'], development:['Player Development','Review future cloud-backed development records.'], settings:['Settings','Configure the team hub experience and future integrations.'] }; const [title, sub] = titles[view]; return shell(title, sub, `<section class="card empty-view"><div class="empty-icon">${view === 'settings' ? '⚙' : '✦'}</div><h2>Workspace unavailable</h2><p>This surface does not have approved cloud-backed data for the selected team and season.</p></section>`); }
function admin() {
  const owner = can(PERMISSIONS.ADMIN_USERS, activeStaff);
  return shell('Admin', 'Set up the people and access model for the team.', `${owner
    ? `<section class="card">${cardTitle('Accounts & permissions', 'Database-enforced Owner controls')}
      <div class="callout admin-context-note"><strong>${escapeHtml(tenantName())}</strong> · ${escapeHtml(tenantSeasonName())}<br>Memberships and capabilities are loaded from the selected team context. Account changes remain limited to the approved invite and setup-link flows.</div>
      <div class="staff-grid"><article class="staff-card"><div class="staff-avatar">${activeStaff.initials}</div><div><h3>${escapeHtml(activeStaff.name)}</h3><p>${escapeHtml(activeStaff.role)}</p><span class="role-status">Authenticated team member</span></div></article></div>
      <div class="permission-summary"><strong>Owner controls enabled</strong><span>${authCapabilities.length} database-provided capabilities</span></div>
      <div class="admin-divider"></div>
      <div class="card-title"><h2>Invite staff</h2><span class="admin-security-note">Only Owner / Head Coach can invite</span></div>
      <form class="invite-form" id="inviteForm">
        <label>Name<input id="inviteName" type="text" maxlength="120" autocomplete="name" required placeholder="Austin Koposko" /></label>
        <label>Email<input id="inviteEmail" type="email" maxlength="254" autocomplete="email" required placeholder="staff@example.com" /></label>
        <label>Role<select id="inviteRole" required><option value="assistant_goalie">Assistant Coach / Goalie Coach</option><option value="assistant">Assistant Coach</option></select></label>
        <button class="btn primary" type="submit">Send invite</button>
      </form>
      <div class="invite-status" id="inviteStatus" role="status">Invite delivery is not started until you submit this form.</div>
      <div class="card-title invite-list-title"><h2>Invite status</h2><button class="btn" id="refreshInvites" type="button">Refresh</button></div>
      <div id="inviteList" class="invite-list"><span class="permission-lock">Loading invite status…</span></div>
    </section>`
    : `<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Admin controls are restricted</h2><p>Only the Owner / Head Coach can manage accounts and permissions. Your current role can continue using its assigned team workflows.</p></section>`}`);
}

function inviteStatusMessage(message, kind = '') {
  const node = document.querySelector('#inviteStatus');
  if (node) {
    node.className = `invite-status${kind ? ` ${kind}` : ''}`;
    node.textContent = message;
  }
}

function inviteRoleLabel(roleId) {
  return roleId === 'assistant_goalie' ? 'Assistant Coach / Goalie Coach' : 'Assistant Coach';
}

function renderInviteList(invites = []) {
  const list = document.querySelector('#inviteList');
  if (!list) return;
  if (!invites.length) {
    list.innerHTML = '<span class="permission-lock">No pending staff invites.</span>';
    return;
  }
  list.innerHTML = invites.map(invite => `<div class="invite-row"><div><strong>${escapeHtml(invite.display_name || 'Pending staff member')}</strong><small>${escapeHtml(invite.email || 'Email hidden')}</small></div><span>${escapeHtml(inviteRoleLabel(invite.role_id))}</span><b class="invite-badge ${escapeHtml(invite.status)}">${escapeHtml(invite.status)}</b>${['pending', 'expired'].includes(invite.status) ? `<button class="btn resend-setup-button" type="button" data-user-id="${escapeHtml(invite.user_id)}">Resend setup link</button>` : ''}</div>`).join('');
}

// Every invite-staff action is team-scoped: the Edge Function rejects any
// request that does not identify a team. Both the list and invite paths must
// therefore send the active team context. Sending the id as well as the slug
// lets the function resolve the team even if the slug is missing from the
// membership row.
function inviteTeamContext() {
  return {
    teamSlug: authTeam?.teams?.slug || '',
    teamId: authTeam?.team_id || ''
  };
}

async function loadInviteStatus() {
  const list = document.querySelector('#inviteList');
  if (list) list.innerHTML = '<span class="permission-lock">Loading invite status…</span>';
  const teamContext = inviteTeamContext();
  if (!teamContext.teamSlug && !teamContext.teamId) {
    if (list) list.innerHTML = '<span class="permission-lock">Select a team to view invite status.</span>';
    return;
  }
  const { data, error } = await supabaseClient.functions.invoke(INVITE_FUNCTION, {
    body: { action: 'list', ...teamContext }
  });
  if (error) {
    console.warn('Could not load invite status:', error);
    if (list) list.innerHTML = `<span class="auth-error">${escapeHtml(error.message || 'Invite status is unavailable.')}</span>`;
    return;
  }
  renderInviteList(data?.invites || []);
}

async function submitStaffInvite(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Sending invite…';
  inviteStatusMessage('Verifying Owner permissions and creating the pending membership…');
  const body = {
    action: 'invite',
    displayName: form.querySelector('#inviteName').value.trim(),
    email: form.querySelector('#inviteEmail').value.trim(),
    roleId: form.querySelector('#inviteRole').value,
    ...inviteTeamContext()
  };
  const { data, error } = await supabaseClient.functions.invoke(INVITE_FUNCTION, { body });
  button.disabled = false;
  button.textContent = 'Send invite';
  if (error) {
    console.warn('Staff invite rejected:', error);
    inviteStatusMessage(error.message || 'The staff invite could not be sent.', 'error');
    return;
  }
  inviteStatusMessage(data?.message || 'Invite sent and pending membership created.', 'success');
  form.reset();
  await loadInviteStatus();
}

async function resendSetupLink(event) {
  const button = event.currentTarget;
  const userId = button.dataset.userId;
  if (!userId || button.disabled) return;
  button.disabled = true;
  button.textContent = 'Sending…';
  inviteStatusMessage('Verifying the invited membership and sending a new setup link…');
  const { data, error } = await supabaseClient.functions.invoke(INVITE_FUNCTION, {
    body: { action: 'resend_setup', userId, ...inviteTeamContext() }
  });
  if (error) {
    console.warn('Setup link resend rejected:', error);
    inviteStatusMessage(error.message || 'The setup link could not be sent.', 'error');
    button.disabled = false;
    button.textContent = 'Resend setup link';
    return;
  }
  inviteStatusMessage(data?.message || 'A new setup link was sent.', 'success');
  button.textContent = 'Sent recently';
  window.setTimeout(() => {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = 'Resend setup link';
    }
  }, 60_000);
}

function bindAdminControls() {
  const form = document.querySelector('#inviteForm');
  if (!form) return;
  form.addEventListener('submit', submitStaffInvite);
  document.querySelector('#refreshInvites')?.addEventListener('click', loadInviteStatus);
  document.querySelector('#inviteList')?.addEventListener('click', event => {
    const button = event.target.closest('.resend-setup-button');
    if (button) resendSetupLink({ currentTarget: button });
  });
  loadInviteStatus();
}
function generic(view) { const titles = { games:['Game Center','One place for game-day details and post-game review.'], reports:['Coach Reports','Turn team observations into clear, shareable reports.'], settings:['Settings','Configure the team hub experience and future integrations.'] }; const [title, sub] = titles[view]; return shell(title, sub, `<section class="card empty-view"><div class="empty-icon">${view === 'settings' ? '⚙' : '✦'}</div><h2>Your next workspace layer</h2><p>This team workspace reserves the workflow for ${title.toLowerCase()}. This surface is ready to connect to synced analytics, schedules, reports, and player information.</p></section>`); }

function renderTeamSwitcher() {
  const host = document.querySelector('#teamSwitcher');
  if (!host || !teamContext.memberships.length) return;
  if (teamContext.memberships.length === 1) {
    host.innerHTML = `<span class="team-switcher-label">Team</span><strong>${escapeHtml(teamContext.selectedMembership?.teams?.name || 'Selected team')}</strong>`;
  } else {
    host.innerHTML = `<label><span class="team-switcher-label">Team</span><select id="teamSelect" aria-label="Selected team">${teamContext.memberships.map(membership => `<option value="${escapeHtml(membership.team_id)}" ${membership.team_id === teamContext.selectedTeamId ? 'selected' : ''}>${escapeHtml(membership.teams?.name || membership.team_id)}</option>`).join('')}</select></label>`;
    host.querySelector('#teamSelect').addEventListener('change', event => selectTeam(event.target.value));
  }
  host.hidden = false;
}

function renderTenantBranding() {
  const displayName = tenantName();
  const seasonName = tenantSeasonName();
  const mark = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'PN';
  const tenantMark = document.querySelector('#tenantMark');
  const tenantNameNode = document.querySelector('#tenantName');
  const tenantSeasonLabel = document.querySelector('#tenantSeasonLabel');
  const tenantFooter = document.querySelector('#tenantFooter');
  const teamStatus = document.querySelector('#teamStatus');
  if (tenantMark) tenantMark.textContent = mark;
  if (tenantNameNode) tenantNameNode.textContent = displayName;
  if (tenantSeasonLabel) tenantSeasonLabel.textContent = seasonName;
  if (tenantFooter) tenantFooter.textContent = displayName;
  if (teamStatus) teamStatus.textContent = `${displayName} · ${activeStaff?.role || 'Team workspace'}`;
}

async function selectTeam(teamId) {
  if (teamId === teamContext.selectedTeamId) return;
  teamContextManager.select(teamId);
  await loadSelectedTeam();
}

function renderSeasonSwitcher() {
  const host = document.querySelector('#seasonSwitcher');
  if (!host || !seasonContext.seasons.length) return;
  if (seasonContext.seasons.length === 1) {
    host.innerHTML = `<span class="season-switcher-label">Season</span><strong>${escapeHtml(seasonContext.selectedSeason?.name || seasonContext.selectedSeason?.season_key || 'Selected season')}</strong>`;
  } else {
    host.innerHTML = `<label><span class="season-switcher-label">Season</span><select id="seasonSelect" aria-label="Selected season">${seasonContext.seasons.map(season => `<option value="${escapeHtml(season.id)}" ${season.id === seasonContext.selectedSeasonId ? 'selected' : ''}>${escapeHtml(season.name || season.season_key)}</option>`).join('')}</select></label>`;
    host.querySelector('#seasonSelect').addEventListener('change', event => selectSeason(event.target.value));
  }
  host.hidden = false;
}

async function selectSeason(seasonId) {
  if (seasonId === seasonContext.selectedSeasonId) return;
  seasonContextManager.select(seasonId);
  phase1Data = null;
  phase1DataError = '';
  phase2AData = null;
  phase2ADataError = '';
  render();
  await Promise.all([loadPhase1Data(authTeam.team_id), loadPhase2AData(authTeam.team_id)]);
}

async function loadSelectedTeam() {
  const membership = teamContext.selectedMembership;
  if (!membership) return;
  authTeam = membership;
  const { data: permissions, error: permissionError } = await supabaseClient.from('role_permissions').select('capability').eq('role_id', membership.role_id);
  if (permissionError) throw new Error('Team permissions could not be loaded.');
  authCapabilities = permissions.map(permission => permission.capability);
  activeStaff = { ...activeStaff, roleId: membership.role_id, role: membership.roles?.label || membership.role_id, capabilities: authCapabilities };
  phase1Data = null;
  phase1DataError = '';
  phase2AData = null;
  phase2ADataError = '';
  render();
  await seasonContextManager.load(membership.team_id, membership.teams?.default_season_id);
  renderTenantBranding();
  document.querySelector('#teamStatus').textContent = `${tenantName()} · ${activeStaff.role}`;
  renderTeamSwitcher();
  renderSeasonSwitcher();
  await Promise.all([loadPhase1Data(membership.team_id), loadPhase2AData(membership.team_id)]);
}

function renderRoleSwitcher() {
  document.querySelector('#userAvatar').textContent = activeStaff.initials;
  document.querySelector('#userName').textContent = activeStaff.name;
  const userMenu = document.querySelector('.user-menu');
  if (!userMenu.querySelector('.signout-button')) {
    const button = document.createElement('button');
    button.className = 'signout-button';
    button.type = 'button';
    button.textContent = 'Sign out';
    button.onclick = signOut;
    userMenu.appendChild(button);
  }
}
function render(view = 'command') {
  if (!can(roleViews[view], activeStaff)) view = 'command';
  const sameView = view === lastRenderedView;
  const preservedScroll = sameView ? window.scrollY : 0;
  const page = view === 'scouting'
    ? scouting()
    : phase1DataError
      ? shell('Team data unavailable', 'The authenticated workspace is available, but the live team data could not be read.', `<section class="card empty-view"><div class="empty-icon">!</div><h2>Unable to load synced team data</h2><p>${escapeHtml(phase1DataError)}</p><button class="btn primary" id="retryPhase1Data" type="button">Retry</button></section>`)
      : !phase1Data
        ? shell('Loading team data', 'Reading the live team roster, schedule, games, and stats…', '<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Loading synced team data</h2><p>Please wait while the secure workspace reads your team data.</p></section>')
        : view === 'command' ? command() : view === 'schedule' ? schedule() : view === 'stats' ? stats() : view === 'players' ? players() : view === 'games' ? gameCenter() : view === 'reports' ? reports() : view === 'development' ? development() : view === 'settings' ? settings() : view === 'admin' ? admin() : generic(view);
  app.innerHTML = page;
  document.querySelector('#viewCrumb').textContent = viewNames[view]; renderRoleSwitcher();
  renderTeamSwitcher();
  renderSeasonSwitcher();
  renderTenantBranding();
  const seasonPill = document.querySelector('#seasonPill');
  if (seasonPill) seasonPill.firstChild.textContent = tenantSeasonName();
  document.querySelector('#retryPhase1Data')?.addEventListener('click', () => loadPhase1Data(authTeam.team_id));
  document.querySelector('#retryPhase2AData')?.addEventListener('click', () => loadPhase2AData(authTeam.team_id));
  if (view === 'admin') bindAdminControls();
  if (view === 'schedule') bindCoachGameControls();
  if (view === 'players') bindCoachRosterControls();
  if (view === 'games') bindCoachStatsControls();
  if (view === 'command') bindDashboardControls();
  nav.forEach(item => { const allowed = can(roleViews[item.dataset.view], activeStaff); item.hidden = !allowed; item.classList.toggle('active', item.dataset.view === view); item.toggleAttribute('aria-current', item.dataset.view === view); });
  document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#scrim').classList.remove('show');
  lastRenderedView = view;
  // Only a real view change resets the page to the top.
  window.scrollTo(0, sameView ? preservedScroll : 0);
}
nav.forEach(item => item.addEventListener('click', () => render(item.dataset.view)));
document.querySelector('#openSidebar').addEventListener('click', () => { document.querySelector('#sidebar').classList.add('open'); document.querySelector('#scrim').classList.add('show'); });
document.querySelector('#closeSidebar').addEventListener('click', () => { document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#scrim').classList.remove('show'); });
document.querySelector('#scrim').addEventListener('click', () => document.querySelector('#closeSidebar').click());
function showLoading() {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="brand-mark">PN</div><div><strong>${PLATFORM.name}</strong><span>${PLATFORM.tagline}</span></div></div><h1>Restoring your session</h1><p class="auth-loading">Connecting to the secure team workspace…</p></div>`;
}

function showLogin(error = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="brand-mark">PN</div><div><strong>${PLATFORM.name}</strong><span>${PLATFORM.tagline}</span></div></div><h1>Sign in to your team hub</h1><p>Use your ${PLATFORM.name} account to access your authorized team workspace.</p><form class="auth-form" id="loginForm"><label>Email<input id="loginEmail" type="email" autocomplete="username" required /></label><label>Password<input id="loginPassword" type="password" autocomplete="current-password" required /></label>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}<button class="btn primary" type="submit">Sign in</button></form></div>`;
  authScreen.querySelector('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email: event.currentTarget.querySelector('#loginEmail').value, password: event.currentTarget.querySelector('#loginPassword').value });
      if (error) {
        console.warn('Supabase sign-in rejected:', { message: error.message, code: error.code, status: error.status });
        showLogin(formatAuthError(error));
        return;
      }
      await loadAuthenticatedWorkspace(data.session?.user || null);
    } catch (error) {
      workspaceTransitioning = false;
      console.error('Supabase sign-in request failed:', error);
      showLogin(formatAuthError(error));
    }
  });
}

function showPasswordRecovery(error = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="brand-mark">PN</div><div><strong>${PLATFORM.name}</strong><span>${PLATFORM.tagline}</span></div></div><h1>Set a new password</h1><p>Choose a new password for your ${PLATFORM.name} account.</p><form class="auth-form" id="recoveryForm"><label>New password<input id="recoveryPassword" type="password" autocomplete="new-password" minlength="8" required /></label><label>Confirm new password<input id="recoveryPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required /></label>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}<button class="btn primary" type="submit">Update password</button></form></div>`;
  authScreen.querySelector('#recoveryForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = form.querySelector('#recoveryPassword');
    const confirmation = form.querySelector('#recoveryPasswordConfirm');
    if (password.value !== confirmation.value) {
      showPasswordRecovery('The passwords do not match.');
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    button.textContent = 'Updating password…';
    try {
      const { error } = await supabaseClient.auth.updateUser({ password: password.value });
      password.value = '';
      confirmation.value = '';
      if (error) {
        console.warn('Supabase password update rejected:', { message: error.message, code: error.code, status: error.status });
        showPasswordRecovery(formatAuthError(error));
        return;
      }
      recoveryMode = false;
      window.history.replaceState({}, document.title, window.location.pathname);
      await loadAuthenticatedWorkspace();
    } catch (error) {
      workspaceTransitioning = false;
      password.value = '';
      confirmation.value = '';
      console.error('Supabase password update request failed:', error);
      showPasswordRecovery(formatAuthError(error));
    }
  });
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character])); }

async function acceptPendingWorkspaceInvite() {
  if (!pendingInviteToken) return '';
  if (!/^[0-9a-f]{64}$/i.test(pendingInviteToken)) {
    pendingInviteToken = '';
    return 'The invitation link is invalid. Ask your team owner to resend it.';
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pendingInviteToken));
  const tokenHash = Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
  pendingInviteToken = '';
  const { error } = await supabaseClient.rpc('accept_workspace_invite', {
    target_token_hash: tokenHash
  });
  return error ? (error.message || 'The invitation could not be accepted.') : '';
}
function formatAuthError(error) {
  if (!error) return 'Sign-in could not be completed.';
  const message = typeof error.message === 'string' && error.message.trim() ? error.message.trim() : 'Sign-in could not be completed.';
  const detail = [error.code, error.status ? `HTTP ${error.status}` : ''].filter(Boolean).join(' · ');
  return detail ? `${message} (${detail})` : message;
}

async function loadPhase1Data(teamId) {
  phase1Data = null;
  phase1DataError = '';
  render();
  const requests = [];
  const selectedSeasonId = seasonContext.selectedSeasonId || '';
  const read = (key, table, columns, capability, transform = rows => rows || [], seasonScoped = false) => {
    if (!can(capability, activeStaff)) return;
    let query = supabaseClient.from(table).select(columns).eq('team_id', teamId);
    if (seasonScoped && selectedSeasonId) query = query.eq('season_id', selectedSeasonId);
    requests.push(query.then(({ data, error }) => {
      if (error) throw new Error(`${key}: ${error.message}`);
      return [key, transform(data)];
    }));
  };
  read('roster', 'team_roster_players', 'id,source_player_id,jersey_number,name,first_name,last_name,position,player_type,status,season_id', PERMISSIONS.PLAYERS_VIEW, rows => (rows || []).filter(row => row.status === 'active'));
  // `id` is the row identity used by the Edit/Delete controls; without it every
  // schedule action resolves to an undefined ID and silently no-ops.
  read('schedule', 'team_schedule_games', 'id,source_schedule_id,date,time,opponent,home_away,game_type,location,notes,linked_game_source_id', PERMISSIONS.SCHEDULE_VIEW);
  read('games', 'team_games', 'source_game_id,season_id,date,opponent,period_length_min', PERMISSIONS.GAMES_VIEW, undefined, true);
  read('playerStats', 'team_game_player_stats', 'source_game_id,season_id,source_player_id,player_type,gp,goals,assists,shots,penalty_minutes,plus_minus,blocks,faceoff_wins,faceoff_losses,faceoff_attempts,power_play_goals,power_play_assists,power_play_points,short_handed_goals,short_handed_assists,short_handed_points,game_winning_goals,game_tying_goals,takeaways,giveaways,chances,toi_minutes,minutes,saves,goals_against,wins,losses,ties,shutouts', PERMISSIONS.STATS_VIEW, undefined, true);
  read('teamStats', 'team_game_team_stats', 'source_game_id,season_id,goals_for,goals_against,shots_for,shots_against,power_play_chances,power_play_success,penalty_kill_chances,penalty_kill_success,faceoff_wins,faceoff_losses', PERMISSIONS.STATS_VIEW, undefined, true);
  const seasonKey = seasonContext.selectedSeason?.season_key || '';
  const seasonRequest = can(PERMISSIONS.REPORTS_VIEW, activeStaff)
    ? (seasonKey
      ? supabaseClient.from('team_season_records').select('season_key,games_played,wins,losses,ties,goals_for,goals_against,source_game_count').eq('team_id', teamId).eq('season_key', seasonKey).maybeSingle().then(({ data, error }) => { if (error) throw new Error(`season record: ${error.message}`); return ['seasonRecord', data]; })
      : supabaseClient.from('team_season_records').select('season_key,games_played,wins,losses,ties,goals_for,goals_against,source_game_count').eq('team_id', teamId).order('computed_at', { ascending: false }).limit(1).maybeSingle().then(({ data, error }) => { if (error) throw new Error(`season record: ${error.message}`); return ['seasonRecord', data]; }))
    : Promise.resolve(['seasonRecord', null]);
  requests.push(seasonRequest);
  try {
    const entries = await Promise.all(requests);
    const loaded = Object.fromEntries(entries);
    const seasonRecord = loaded.seasonRecord || (loaded.teamStats || []).reduce((summary, row) => {
      summary.games_played += 1;
      summary.goals_for += phase1Number(row.goals_for);
      summary.goals_against += phase1Number(row.goals_against);
      if (row.goals_for > row.goals_against) summary.wins += 1;
      else if (row.goals_for < row.goals_against) summary.losses += 1;
      else summary.ties += 1;
      return summary;
    }, { games_played: 0, wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 });
    phase1Data = { roster: loaded.roster || [], schedule: loaded.schedule || [], games: loaded.games || [], playerStats: loaded.playerStats || [], teamStats: loaded.teamStats || [], seasonRecord };
    render();
  } catch (error) {
    phase1DataError = error.message || 'The live team data could not be loaded.';
    render();
  }
}

async function loadPhase2AData(teamId) {
  phase2AData = null;
  phase2ADataError = '';
  if (!can(PERMISSIONS.SCOUTING_VIEW, activeStaff)) {
    phase2AData = { profiles: [], players: [] };
    render('scouting');
    return;
  }
  try {
    const [{ data: profiles, error: profileError }, { data: players, error: playerError }] = await Promise.all([
      supabaseClient.from('phase2_opponent_profiles').select('source_profile_key,opponent_name').eq('team_id', teamId).order('opponent_name'),
      supabaseClient.from('phase2_opponent_players').select('source_player_key,source_game_id,opponent_profile_key,jersey_number,player_name,position,source_kind').eq('team_id', teamId).order('player_name')
    ]);
    if (profileError) throw new Error(`opponent profiles: ${profileError.message}`);
    if (playerError) throw new Error(`opponent players: ${playerError.message}`);
    phase2AData = { profiles: profiles || [], players: players || [] };
  } catch (error) {
    phase2ADataError = error.message || 'The synced opponent data could not be loaded.';
  }
  render('scouting');
}

function initialsFor(name) {
  return String(name || 'PN').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'PN';
}

function clearWorkspaceState() {
  authUser = null;
  authTeam = null;
  activeStaff = null;
  authCapabilities = [];
  phase1Data = null;
  phase1DataError = '';
  phase2AData = null;
  phase2ADataError = '';
  currentDestination = '';
  platformAccessManager.clear();
  platformAdminManager.unmount();
  onboardingManager?.unmount();
  onboardingManager = null;
  teamContextManager.clearSelection();
  seasonContextManager.clear();
}

function bindAuthScreenSignOut() {
  authScreen.querySelector('#authScreenSignOut')?.addEventListener('click', signOut);
}

function showPlatformLanding(displayName, hasTeamMemberships) {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.removeAttribute('aria-hidden');
  const roleLabel = platformAccess.isFounder ? 'Founder' : 'Platform Admin';
  authScreen.innerHTML = `<div class="auth-card admin-auth-card"><div class="auth-brand"><div class="brand-mark">PN</div><div><strong>${PLATFORM.name}</strong><span>${PLATFORM.tagline}</span></div></div><h1>Admin Dashboard</h1><p class="admin-identity">Signed in as ${escapeHtml(displayName)} · ${escapeHtml(roleLabel)}</p><div id="platformAdminRoot" class="platform-admin-root-host"></div><div class="auth-actions">${hasTeamMemberships ? '<button class="btn" id="continueToTeamWorkspace" type="button">Open team workspace</button>' : ''}<button class="btn" id="authScreenSignOut" type="button">Sign out</button></div></div>`;
  platformAdminManager.mount(authScreen.querySelector('#platformAdminRoot'));
  authScreen.querySelector('#continueToTeamWorkspace')?.addEventListener('click', () => {
    platformAdminManager.unmount();
    const user = authUser;
    const name = activeStaff?.name || displayName;
    activeStaff = null;
    enterTeamWorkspace(user, name).catch(error => {
      console.error('Could not enter the team workspace:', error);
      showLogin('Unable to load your secure team workspace.');
    });
  });
  bindAuthScreenSignOut();
}

function showOnboarding(destination) {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.removeAttribute('aria-hidden');
  const pendingTeams = (destination.pending || []).map(item => item.teams?.name).filter(Boolean).join(', ');
  authScreen.innerHTML = `<div class="auth-card onboarding-auth-card"><div class="auth-brand"><div class="brand-mark">PN</div><div><strong>${PLATFORM.name}</strong><span>${PLATFORM.tagline}</span></div></div><div id="onboardingRoot" class="onboarding-root-host"></div></div>`;
  onboardingManager = window.FoxesOnboarding.createOnboarding({
    client: supabaseClient,
    user: authUser,
    branding: PLATFORM,
    onComplete: () => {
      onboardingManager?.unmount();
      onboardingManager = null;
      const user = authUser;
      activeStaff = null;
      teamContextManager.clearSelection();
      loadAuthenticatedWorkspace(user).catch(error => {
        console.error('Could not enter the team workspace after onboarding:', error);
        showLogin('Setup is complete, but your workspace could not be loaded. Sign in again to continue.');
      });
    },
    onSignOut: signOut
  });
  onboardingManager.mount(authScreen.querySelector('#onboardingRoot'));
  if (pendingTeams) {
    const host = authScreen.querySelector('.onboarding-head p');
    if (host) host.textContent = `You have a pending invitation to ${pendingTeams}. Complete setup or sign out and use the setup link from your invitation email.`;
  }
}

function showNoAccess(message = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.removeAttribute('aria-hidden');
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="brand-mark">PN</div><div><strong>${PLATFORM.name}</strong><span>${PLATFORM.tagline}</span></div></div><h1>No active team access</h1><p>${escapeHtml(message || 'This account has no platform role and no active organization or team membership. An invitation from your organization or team owner is required before a workspace can be opened.')}</p><div class="auth-actions"><button class="btn" id="authScreenSignOut" type="button">Sign out</button></div></div>`;
  bindAuthScreenSignOut();
}

async function enterTeamWorkspace(user, displayName) {
  const selectedMembership = teamContext.selectedMembership;
  if (!selectedMembership) {
    showNoAccess();
    return;
  }
  authUser = user;
  authTeam = selectedMembership;
  activeStaff = { id: user.id, name: displayName, initials: initialsFor(displayName), roleId: selectedMembership.role_id, role: selectedMembership.roles?.label || selectedMembership.role_id, capabilities: [] };
  await loadSelectedTeam();
  appShell.hidden = false;
  appShell.removeAttribute('aria-hidden');
  authScreen.hidden = true;
  authScreen.setAttribute('aria-hidden', 'true');
}

async function loadAuthenticatedWorkspace(sessionUser = null) {
  if (activeStaff) return;
  if (workspaceTransitioning) return;
  workspaceTransitioning = true;
  try {
    const user = sessionUser || (await supabaseClient.auth.getSession()).data.session?.user;
    if (!user) {
      showLogin(sessionNotice);
      sessionNotice = '';
      return;
    }
    const inviteAcceptanceError = await acceptPendingWorkspaceInvite();
    // Central bootstrap: session → platform access → org/team access →
    // onboarding state → one destination decision. Protected UI renders only
    // after the resolver returns an authorized destination.
    await platformAccessManager.load();
    let membershipContext;
    try {
      membershipContext = await teamContextManager.load(user.id);
    } catch (error) {
      membershipContext = null;
      console.error('Could not load team memberships:', error);
    }
    const { data: profile } = await supabaseClient.from('profiles').select('id,display_name').eq('id', user.id).maybeSingle();
    const { data: onboardingProgress } = await supabaseClient.from('onboarding_progress').select('user_id,organization_id,team_id,season_id,current_step,completed_at').eq('user_id', user.id).maybeSingle();
    const displayName = profile?.display_name || user.email || 'PuckNexus user';
    const destination = resolveDestination({
      user,
      platformAccess,
      memberships: membershipContext?.memberships || [],
      pendingMemberships: teamContext.pendingMemberships,
      onboardingProgress: onboardingProgress || null
    });
    currentDestination = destination.state;
    authUser = user;
    if (destination.state === DESTINATIONS.PLATFORM_ADMIN) {
      activeStaff = { id: user.id, name: displayName, initials: initialsFor(displayName), roleId: 'platform', role: platformAccess.isFounder ? 'Founder' : 'Platform Admin', capabilities: [] };
      showPlatformLanding(displayName, destination.memberships.length > 0);
      return;
    }
    if (destination.state === DESTINATIONS.ONBOARDING) {
      showOnboarding(destination);
      if (inviteAcceptanceError) {
        const host = authScreen.querySelector('.onboarding-head p');
        if (host) host.textContent = inviteAcceptanceError;
      }
      return;
    }
    if (destination.state === DESTINATIONS.NO_ACCESS) {
      showNoAccess(inviteAcceptanceError || (membershipContext ? '' : 'Your memberships could not be verified. Sign out and try again, or contact your organization owner.'));
      return;
    }
    await enterTeamWorkspace(user, displayName);
  } catch (error) {
    clearWorkspaceState();
    console.error('Could not load the authenticated workspace:', error);
    showLogin('Unable to load your secure team workspace.');
  } finally {
    workspaceTransitioning = false;
  }
}

async function signOut() {
  intentionalSignOut = true;
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    intentionalSignOut = false;
    console.error('Could not sign out:', error);
    return;
  }
  clearWorkspaceState();
  showLogin();
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryMode = true;
    showPasswordRecovery();
    return;
  }
  // A token refresh must not tear down an authorized workspace.
  if (event === 'TOKEN_REFRESHED') return;
  if (event === 'USER_UPDATED') {
    platformAccessManager.load().catch(error => console.warn('Platform access could not be re-resolved:', error));
    return;
  }
  if (event === 'SIGNED_IN' && session?.user) {
    // A different account signing in over an existing session gets a full
    // state reset before any of its data is resolved.
    if (activeStaff && authUser && session.user.id !== authUser.id) {
      clearWorkspaceState();
    }
    if (!activeStaff) {
      setTimeout(() => loadAuthenticatedWorkspace(session.user), 0);
    }
    return;
  }
  if (event === 'SIGNED_OUT' || (!session && activeStaff)) {
    sessionNotice = intentionalSignOut ? '' : 'Your session has expired. Please sign in again.';
    intentionalSignOut = false;
    clearWorkspaceState();
    showLogin(sessionNotice);
    sessionNotice = '';
  }
});

if (recoveryCallbackPresent) {
  recoveryMode = true;
  showLoading();
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) showPasswordRecovery();
    else showLogin('This recovery link is missing or expired. Request a new link from Supabase.');
  }).catch(() => showLogin('This recovery link could not be loaded.'));
} else if (prototypeMode && !recoveryMode) {
  activeStaff = { ...STAFF[0], capabilities: window.FoxesPermissions.ROLE_PERMISSIONS.owner };
  phase1Data = { roster: [], schedule: [], games: [], playerStats: [], teamStats: [], seasonRecord: { games_played: 0, wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 } };
  appShell.hidden = false;
  render();
} else {
  showLoading();
  loadAuthenticatedWorkspace().catch(() => {
    workspaceTransitioning = false;
    showLogin('Unable to restore your Supabase session.');
  });
}
