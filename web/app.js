const { PERMISSIONS, STAFF, can } = window.FoxesPermissions;
const { PLATFORM, applyDocumentBrand } = window.FoxesPlatformBranding;
const app = document.querySelector('#app');
const nav = document.querySelectorAll('.nav-item');
const authScreen = document.querySelector('#authScreen');
const appShell = document.querySelector('#appShell');
const SUPABASE_URL = 'https://yshbvrumzusmwlprfcnr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PFK2d1or62DYpk3VxarJwA_Anazyv7D';
const SUPABASE_PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
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
  branding: PLATFORM,
  canOpenTeamHub: teamId => teamContext.memberships.some(membership => membership.team_id === teamId && membership.status === 'active'),
  onOpenTeamHub: teamId => {
    if (!platformAccess.isPlatformAdmin || !teamContext.memberships.some(membership => membership.team_id === teamId && membership.status === 'active')) return;
    try { teamContextManager.select(teamId); } catch { return; }
    platformAdminManager.unmount();
    const user = authUser;
    const name = activeStaff?.name || user?.email || 'Team member';
    activeStaff = null;
    enterTeamWorkspace(user, name).catch(error => {
      console.error('Could not open the authorized team hub:', error);
      showPlatformLanding(name, teamContext.memberships.length > 0);
    });
  }
});
const filmRoom = window.FoxesFilmRoom.createFilmRoom({
  client: supabaseClient,
  supabaseUrl: SUPABASE_URL,
  publishableKey: SUPABASE_PUBLISHABLE_KEY,
  projectRef: SUPABASE_PROJECT_REF,
  getContext: () => ({
    teamId: authTeam?.team_id || '',
    organizationId: authTeam?.teams?.organization_id || authTeam?.organization_id || '',
    teamName: tenantName(),
    seasonId: seasonContext.selectedSeasonId || '',
    seasonName: tenantSeasonName(),
    userId: authUser?.id || '',
    capabilities: authCapabilities,
    games: phase1Data?.games || []
  }),
  onChanged: () => loadPhase1Data(authTeam?.team_id)
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

const viewNames = { command: 'Command Center', schedule: 'Schedule', stats: 'Analytics', players: 'Player Profiles', games: 'Game Center', film: 'Film Room', scouting: 'Scouting', reports: 'Coach Reports', development: 'Player Development', admin: 'Admin', settings: 'Team Settings' };
const roleViews = { command: PERMISSIONS.DASHBOARD_VIEW, schedule: PERMISSIONS.SCHEDULE_VIEW, stats: PERMISSIONS.STATS_VIEW, players: PERMISSIONS.PLAYERS_VIEW, games: PERMISSIONS.GAMES_VIEW, film: PERMISSIONS.FILM_VIEW, scouting: PERMISSIONS.SCOUTING_VIEW, reports: PERMISSIONS.REPORTS_VIEW, development: PERMISSIONS.PLAYERS_VIEW, admin: PERMISSIONS.ADMIN_USERS, settings: PERMISSIONS.DASHBOARD_VIEW };

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
  onChanged: async () => {
    // Returned so callers can await the reload; this is what makes UI
    // restoration deterministic instead of timer-based.
    if (authTeam?.team_id) {
      const view = lastRenderedView || 'command';
      await loadPhase1Data(authTeam.team_id);
      render(view);
    }
    return Promise.resolve();
  }
});
const D = window.FoxesDashboard;
const ActionCenter = window.FoxesActionCenter;
const FE = window.FoxesStatsFilterEngine;
// The single shared active filter context (spec §3.2). Game Center, the
// Analytics tabs below, and any future consumer must read the currently
// selected game set from here rather than filtering `phase1Data.games`
// independently. Exposed on window so Session C's Analytics tabs (and any
// other future consumer) can read/drive the same context without a second
// instance.
const statsFilterContext = FE.createFilterContext({
  getGames: () => phase1Data?.games || [],
  getScheduleGames: () => phase1Data?.schedule || []
});
// Navigation wiring (spec §4) that depends on the filter context: a game
// or player selected anywhere reuses the exact same view + selection-state
// convention the app already uses (selectedGameId + render('games')).
function goToGameCenter(gameId) {
  selectedGameId = gameId;
  render('games');
}
function goToPlayerProfile(playerId) {
  selectedPlayerId = playerId;
  render('players');
}
// Command Center action -> Team Stats (Game Center tab). Session A landed
// the Game Center tab strip with an explicit `team-stats` tab id
// (`gameWorkspaceTab === 'team-stats'`), so this now targets that tab
// directly instead of only opening Game Center's default (overview) tab.
function goToTeamStats(gameId) {
  selectedGameId = gameId;
  gameWorkspaceTab = 'team-stats';
  render('games');
}
window.FoxesFilterContext = Object.assign(statsFilterContext, { goToGameCenter, goToPlayerProfile, goToTeamStats });
let dashboardLeaderCategory = 'points';
let dashboardTrendWindow = 'season';
// Tracks the last painted view so a same-view rerender (leader tabs, trend
// window, data refresh) keeps the reader's scroll position instead of
// snapping the page back to the top.
let lastRenderedView = '';
let actionCenterReturnFocus = null;

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
  const actions = ActionCenter.actionableItems({ roster, schedule: scheduleData, playerStats, teamStats, capabilities: authCapabilities });

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

  return shell(`Command Center`, `Your team. Your next move.`, `
    <section class="command-hero arena-panel"><div class="command-identity">${window.PuckWorkspace.crest(tenantName(), seasonContext.branding?.logo_url)}<div><span class="eyebrow">${escapeHtml(tenantSeasonName())} / TEAM WORKSPACE</span><h2>${escapeHtml(tenantName())}</h2><p>${escapeHtml(window.PuckTeamBranding.appearance(seasonContext.branding, 'command').tagline || 'Every game. Every player. One connected team.')}</p>${window.PuckTeamBranding.appearance(seasonContext.branding, 'command').bio ? `<p class="team-bio">${escapeHtml(window.PuckTeamBranding.appearance(seasonContext.branding, 'command').bio)}</p>` : ''}</div></div><div class="command-next"><span class="eyebrow">${next ? 'UP NEXT' : 'SEASON IN FOCUS'}</span><h3>${next ? 'vs ' + escapeHtml(next.opponent) : 'Build the next win.'}</h3><p>${next ? `${phase1Date(next.date)} · ${escapeHtml(next.time || 'Time TBD')}<br>${escapeHtml(next.location || 'Location TBD')}` : 'Review your team. Prepare for what comes next.'}</p><button class="btn primary" data-dashboard-goto="schedule">${next ? 'Game preparation' : 'View schedule'} <span aria-hidden="true">↗</span></button></div></section>
    <div class="coach-action-strip"><div class="dash-actions">${quickActions.map(([view,label]) => `<button class="btn${label === 'Enter Stats' ? ' primary' : ''}" type="button" data-dashboard-goto="${view}">${label === 'Enter Stats' ? '<span aria-hidden="true">＋</span> ' : ''}${label}</button>`).join('')}</div><span class="coach-action-caption">THE WORK STARTS HERE</span></div>
    ${actions.length ? `<section class="card action-needed">${cardTitle('Needs your attention', `${actions.length} item${actions.length === 1 ? '' : 's'}`)}${actions.map(item => `<button class="action-needed-row" type="button" data-dashboard-action="${escapeHtml(item.view)}" data-action-game="${escapeHtml(item.gameId || '')}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span></button>`).join('')}</section>` : ''}

    <div class="grid stat-grid">
      ${[['Record', snap.hasRecord ? `${snap.w}–${snap.l}–${snap.t}` : '—', `${snap.gp} games played`],
        ['Last 5', last5.count >= 3 ? `${last5.w}–${last5.l}–${last5.t}` : '—', last5.count ? `${last5.count} scored game${last5.count === 1 ? '' : 's'}` : 'No scored games yet'],
        ['Goals For / Against', snap.hasRecord ? `${snap.gf} / ${snap.ga}` : '—', `Differential ${snap.diff > 0 ? '+' : ''}${snap.diff}`],
        ['Shooting %', snap.shootingPct === null ? '—' : `${(snap.shootingPct * 100).toFixed(1)}%`, `${snap.shots} shots on goal`],
        ['Roster', String(roster.length), `${roster.length === 1 ? 'player' : 'players'} active`]]
        .map(x => `<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}
    </div>

    <div class="grid split">
      <section class="card recent">${cardTitle('RECENT GAMES', 'Game Center')}${recent.length ? recent.map(game => `<button type="button" class="game-row recent-game-link" data-recent-game="${escapeHtml(game.id)}"><div><strong>${escapeHtml(game.opponent)}</strong><small>${phase1Date(game.date)}</small></div><span class="score">${escapeHtml(game.score)}</span><span class="result ${game.result === 'W' ? 'win' : game.result === 'L' ? 'loss' : ''}">${game.result === 'W' ? 'WIN' : game.result === 'L' ? 'LOSS' : 'TIE'}</span></button>`).join('') : '<p class="sub">No completed games with scores yet.</p>'}<div class="dash-actions"><button class="btn" type="button" data-dashboard-goto="schedule">View Full Schedule</button></div></section>

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

    <details class="workspace-disclosure dashboard-depth"><summary>Go deeper · goalies &amp; team trends</summary>
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

</details>`);
}

function bindDashboardControls() {
  document.querySelectorAll('[data-recent-game]').forEach(button => button.addEventListener('click', () => { selectedGameId = button.dataset.recentGame; render('games'); }));
  document.querySelectorAll('[data-dashboard-goto]').forEach(button => button.addEventListener('click', () => { render(button.dataset.dashboardGoto); if (button.textContent === 'Add Game') document.querySelector('#scheduleCreate')?.setAttribute('open', ''); if (button.textContent === 'Manage Roster') document.querySelector('.roster-management')?.setAttribute('open', ''); }));
  document.querySelectorAll('[data-dashboard-action]').forEach(button => button.addEventListener('click', () => { if (button.dataset.actionGame) selectedGameId = button.dataset.actionGame; render(button.dataset.dashboardAction); }));
  document.querySelectorAll('[data-leader-cat]').forEach(button => button.addEventListener('click', () => { dashboardLeaderCategory = button.dataset.leaderCat; render('command'); }));
  document.querySelectorAll('[data-trend-window]').forEach(button => button.addEventListener('click', () => { dashboardTrendWindow = button.dataset.trendWindow; render('command'); }));
}
function schedule() {
  const canEdit = can(PERMISSIONS.SCHEDULE_EDIT, activeStaff);
  const canEditScore = can(PERMISSIONS.STATS_EDIT, activeStaff);
  const today = new Date().toISOString().slice(0, 10);
  const games = (phase1Data?.schedule || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const teamStats = new Map((phase1Data?.teamStats || []).map(stats => [stats.source_game_id, stats]));
  const upcoming = games.filter(g => String(g.date) >= today);
  const past = games.filter(g => String(g.date) < today);
  const row = game => {
    const stats = teamStats.get(game.linked_game_source_id);
    const scored = stats?.goals_for !== null && stats?.goals_for !== undefined && stats?.goals_against !== null && stats?.goals_against !== undefined;
    const scoreForm = canEditScore && String(game.date) <= today && game.linked_game_source_id ? `<form class="score-entry" data-score-form>
      <input type="hidden" name="gameId" value="${escapeHtml(game.linked_game_source_id)}" />
      <label>Us<input name="goalsFor" type="number" min="0" step="1" inputmode="numeric" required value="${scored ? escapeHtml(stats.goals_for) : ''}" /></label>
      <span>–</span>
      <label>Them<input name="goalsAgainst" type="number" min="0" step="1" inputmode="numeric" required value="${scored ? escapeHtml(stats.goals_against) : ''}" /></label>
      <button class="btn primary" type="submit" data-score-save>${scored ? 'Update Score' : 'Save Score'}</button>
      <span class="coach-form-status" data-score-status role="status" aria-live="polite"></span>
    </form>` : scored ? `<strong class="schedule-score">${escapeHtml(stats.goals_for)}–${escapeHtml(stats.goals_against)}</strong>` : '';
    return `<div class="schedule-item${String(game.date) < today ? ' past' : ''}"><div class="schedule-date"><strong>${escapeHtml(new Date(`${game.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit' }).toUpperCase())}</strong>${escapeHtml(String(game.date).slice(0, 4))}</div><div><h3>${escapeHtml(game.opponent)}</h3><p>${escapeHtml(game.home_away)} · ${escapeHtml(game.location || 'Location unavailable')}${game.time ? ` · ${escapeHtml(game.time)}` : ''}</p>${scoreForm}</div><span class="tag">${escapeHtml(game.game_type)}</span>${canEdit ? `<span class="schedule-actions"><button class="btn admin-action" type="button" data-coach-edit-game="${escapeHtml(game.id)}">Edit</button><button class="btn admin-action danger" type="button" data-coach-delete-game="${escapeHtml(game.id)}">Delete</button></span>` : ''}</div>`;
  };
  return shell('Schedule', canEdit ? 'Add and manage games. Changes save to the team immediately.' : 'Live schedule synced from the team Windows app.', `
    ${canEdit ? `<details id="scheduleCreate" class="card workspace-disclosure" ${games.length ? '' : 'open'}><summary>+ Add a game</summary><div id="coachGameFormHost">${coachQol.gameFormHtml()}</div></details>` : ''}
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
  document.querySelectorAll('[data-score-form]').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    coachQol.submitScoreForm(event.currentTarget);
  }));
  document.querySelectorAll('[data-coach-edit-game]').forEach(button => button.addEventListener('click', () => {
    const game = (phase1Data?.schedule || []).find(g => g.id === button.dataset.coachEditGame);
    if (!game || !host) return;
    host.closest('details')?.setAttribute('open', '');
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
// Stats 2.0: one global filter bar + tabs for Overview, Trends, Special
// Teams, Periods, Players, Goalies, Games (spec §5). This function owns
// the filter bar + tab shell only (Session B); the 6 non-Overview tabs are
// deliberately left as marked mount points for Session C's Analytics UI,
// which must read the same shared `statsFilterContext` rather than
// filtering games or averaging stats on its own (spec §3, §6).
const STATS_TABS = [
  ['overview', 'Overview'],
  ['trends', 'Trends'],
  ['specialTeams', 'Special Teams'],
  ['periods', 'Periods'],
  ['players', 'Players'],
  ['goalies', 'Goalies'],
  ['games', 'Games']
];
const STATS_MODES = [
  ['season', 'All Season'],
  ['last5', 'Last 5'],
  ['last10', 'Last 10'],
  ['last20', 'Last 20'],
  ['custom', 'Custom range'],
  ['single', 'Single Game']
];
function statsFilterBar(state, gameSet) {
  const games = (phase1Data?.games || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const gameTypeOptions = [...new Set((phase1Data?.schedule || []).map(row => row.game_type).filter(Boolean))].sort();
  const opponentOptions = [...new Set((phase1Data?.games || []).map(game => game.opponent).filter(Boolean))].sort();
  return `<div class="card stats-filter-bar">
    <div class="filter-row">
      <label>Range<select id="statsFilterMode">${STATS_MODES.map(([value, label]) => `<option value="${value}"${state.mode === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
      ${state.mode === 'single' ? `<label>Game<select id="statsFilterGame">${games.map(g => `<option value="${escapeHtml(g.source_game_id)}"${state.params.gameId === g.source_game_id ? ' selected' : ''}>${escapeHtml(phase1Date(g.date))} · ${escapeHtml(g.opponent)}</option>`).join('')}</select></label>` : ''}
      ${state.mode === 'custom' ? `<label>From<input type="date" id="statsFilterStart" value="${escapeHtml(state.params.start || '')}"></label><label>To<input type="date" id="statsFilterEnd" value="${escapeHtml(state.params.end || '')}"></label>` : ''}
      <label>Game Type<select id="statsFilterGameType"><option value="">All types</option>${gameTypeOptions.map(type => `<option value="${escapeHtml(type)}"${state.modifiers.gameType === type ? ' selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select></label>
      <label>Opponent<select id="statsFilterOpponent"><option value="">All opponents</option>${opponentOptions.map(name => `<option value="${escapeHtml(name)}"${state.modifiers.opponent === name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>
    </div>
    <p class="sub">${gameSet.note ? `${escapeHtml(gameSet.note)} · ` : ''}${gameSet.available} game${gameSet.available === 1 ? '' : 's'} selected</p>
  </div>`;
}
function statsOverviewTab(gameSet, teamStatsByGame) {
  const fields = ['goals_for', 'goals_against', 'shots_for', 'shots_against', 'power_play_success', 'power_play_chances', 'penalty_kill_success', 'penalty_kill_chances', 'faceoff_wins', 'faceoff_losses'];
  const agg = FE.aggregateFields(gameSet.games, teamStatsByGame, fields);
  const fmt = value => value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(2);
  const rate = (madeSum, totalSum, recordedCount) => recordedCount > 0 && totalSum > 0 ? `${((madeSum / totalSum) * 100).toFixed(1)}%` : '—';
  return `<section class="card">${cardTitle('Team overview', `${gameSet.available} selected game${gameSet.available === 1 ? '' : 's'} · averages exclude games without a recorded value (see below)`)}
  <div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th><th>Total</th><th>Average / rate</th><th>Recorded in</th></tr></thead><tbody>
  <tr><td>Goals for</td><td>${agg.goals_for.sum}</td><td>${fmt(agg.goals_for.average)}</td><td>${agg.goals_for.recordedCount} of ${gameSet.available}</td></tr>
  <tr><td>Goals against</td><td>${agg.goals_against.sum}</td><td>${fmt(agg.goals_against.average)}</td><td>${agg.goals_against.recordedCount} of ${gameSet.available}</td></tr>
  <tr><td>Shots for</td><td>${agg.shots_for.sum}</td><td>${fmt(agg.shots_for.average)}</td><td>${agg.shots_for.recordedCount} of ${gameSet.available}</td></tr>
  <tr><td>Shots against</td><td>${agg.shots_against.sum}</td><td>${fmt(agg.shots_against.average)}</td><td>${agg.shots_against.recordedCount} of ${gameSet.available}</td></tr>
  <tr><td>Power play</td><td>${agg.power_play_success.sum} / ${agg.power_play_chances.sum}</td><td>${rate(agg.power_play_success.sum, agg.power_play_chances.sum, agg.power_play_chances.recordedCount)}</td><td>${agg.power_play_chances.recordedCount} of ${gameSet.available}</td></tr>
  <tr><td>Penalty kill</td><td>${agg.penalty_kill_success.sum} / ${agg.penalty_kill_chances.sum}</td><td>${rate(agg.penalty_kill_success.sum, agg.penalty_kill_chances.sum, agg.penalty_kill_chances.recordedCount)}</td><td>${agg.penalty_kill_chances.recordedCount} of ${gameSet.available}</td></tr>
  <tr><td>Face-offs</td><td>${agg.faceoff_wins.sum} / ${agg.faceoff_wins.sum + agg.faceoff_losses.sum}</td><td>${rate(agg.faceoff_wins.sum, agg.faceoff_wins.sum + agg.faceoff_losses.sum, agg.faceoff_wins.recordedCount)}</td><td>${agg.faceoff_wins.recordedCount} of ${gameSet.available}</td></tr>
  </tbody></table></div></section>`;
}
function statsStubTab(label) {
  return `<section class="card empty-view"><div class="empty-icon">✦</div><h2>${label}</h2><p>This tab reads the shared filter context above (<code>window.FoxesFilterContext.getGameSet()</code>) but its content is Analytics UI (Session C) scope and is not built here.</p></section>`;
}
function stats() {
  const teamStatsByGame = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  const state = statsFilterContext.getState();
  const gameSet = statsFilterContext.getGameSet();
  const tabStrip = `<nav class="workspace-tabs" aria-label="Analytics sections">${STATS_TABS.map(([id, label]) => `<button type="button" data-stats-tab="${id}" aria-pressed="${statsActiveTab === id}" class="${statsActiveTab === id ? 'active' : ''}">${label}</button>`).join('')}</nav>`;
  const tabContent = statsActiveTab === 'overview' ? statsOverviewTab(gameSet, teamStatsByGame) : statsStubTab(STATS_TABS.find(([id]) => id === statsActiveTab)?.[1] || 'Analytics');
  return shell('Analytics', 'One shared filter — every Analytics tab reads the same selected games.', `${statsFilterBar(state, gameSet)}${tabStrip}${tabContent}`);
}
function bindStatsControls() {
  document.querySelector('#statsFilterMode')?.addEventListener('change', event => {
    const mode = event.target.value;
    const games = (phase1Data?.games || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const params = mode === 'single' ? { gameId: games[0]?.source_game_id || '' } : mode === 'custom' ? { start: '', end: '' } : {};
    statsFilterContext.setMode(mode, params);
    render('stats');
  });
  document.querySelector('#statsFilterGame')?.addEventListener('change', event => {
    statsFilterContext.setMode('single', { gameId: event.target.value });
    render('stats');
  });
  document.querySelector('#statsFilterStart')?.addEventListener('change', event => {
    statsFilterContext.setMode('custom', { ...statsFilterContext.getState().params, start: event.target.value });
    render('stats');
  });
  document.querySelector('#statsFilterEnd')?.addEventListener('change', event => {
    statsFilterContext.setMode('custom', { ...statsFilterContext.getState().params, end: event.target.value });
    render('stats');
  });
  document.querySelector('#statsFilterGameType')?.addEventListener('change', event => {
    statsFilterContext.setModifiers({ gameType: event.target.value || null });
    render('stats');
  });
  document.querySelector('#statsFilterOpponent')?.addEventListener('change', event => {
    statsFilterContext.setModifiers({ opponent: event.target.value || null });
    render('stats');
  });
  document.querySelectorAll('[data-stats-tab]').forEach(button => button.addEventListener('click', () => {
    statsActiveTab = button.dataset.statsTab;
    render('stats');
  }));
}
function players() {
  const totals = playerStatTotals();
  const canEditRoster = can(PERMISSIONS.PLAYERS_EVALUATE, activeStaff);
  return shell('Player Profiles', canEditRoster ? 'Your team, organized by position and jersey number.' : 'Your team, organized by position and jersey number.', `
    ${canEditRoster ? `<details class="card workspace-disclosure roster-management" ${phase1Data?.roster?.length ? '' : 'open'}><summary>Manage roster · add, edit or remove players</summary><div id="coachRosterHost">${coachQol.rosterWorkspaceHtml(window.PuckWorkspace.sortRoster(phase1Data?.roster || []))}</div></details>` : ''}
    <section class="card roster-overview">${cardTitle(`Roster · ${phase1Data?.roster?.length || 0} players`, 'Forwards → Defense → Goalies · jersey order')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Position</th><th>Games</th><th>Goals</th><th>Points</th><th>+ / −</th><th>Status</th></tr></thead><tbody>${window.PuckWorkspace.sortRoster(phase1Data?.roster || []).map(player => { const stat = totals.get(player.source_player_id) || {}; const isSelected = selectedPlayerId && player.source_player_id === selectedPlayerId; return `<tr data-player-row="${escapeHtml(player.source_player_id)}"${isSelected ? ' class="player-row-selected"' : ''}><td><div class="player-cell"><span class="player-photo">${escapeHtml(player.jersey_number)}</span><strong>${escapeHtml(player.name)}</strong></div></td><td data-label="Position" class="role">${escapeHtml(player.position)}</td><td data-label="GP">${phase1Number(stat.games)}</td><td data-label="G">${phase1Number(stat.goals)}</td><td data-label="PTS">${phase1Number(stat.goals) + phase1Number(stat.assists)}</td><td data-label="+/−" class="trend-up">${phase1Number(stat.plus_minus)}</td><td><span class="tag">${canEditRoster ? 'Editable' : 'View only'}</span></td></tr>`; }).join('') || `<tr><td colspan="7">${canEditRoster ? 'Your roster is empty. Add players above before entering game stats.' : 'No roster data is available.'}</td></tr>`}</tbody></table></div></section>`);
}

function bindCoachRosterControls() {
  const host = document.querySelector('#coachRosterHost');
  host?.querySelector('[data-player-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    coachQol.submitPlayerForm(event.currentTarget);
  });
  host?.querySelector('[data-bulk-roster-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    coachQol.submitBulkRosterForm(event.currentTarget);
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
let selectedGameId = '';
let gameWorkspaceTab = 'overview';
const teamStatsFields = [
  ['shots_for_p1', 'Shots for · P1'],
  ['shots_for_p2', 'Shots for · P2'],
  ['shots_for_p3', 'Shots for · P3'],
  ['shots_for_ot', 'Shots for · OT'],
  ['shots_against_p1', 'Shots against · P1'],
  ['shots_against_p2', 'Shots against · P2'],
  ['shots_against_p3', 'Shots against · P3'],
  ['shots_against_ot', 'Shots against · OT'],
  ['power_play_chances', 'Power-play opportunities'],
  ['power_play_success', 'Power-play successes'],
  ['penalty_kill_chances', 'Penalty-kill opportunities'],
  ['penalty_kill_success', 'Penalty-kill successes'],
  ['faceoff_wins', 'Faceoff wins'],
  ['faceoff_losses', 'Faceoff losses']
];
const teamStatsEditor = { gameId: '', original: null, draft: {}, dirty: false, saving: false, status: '' };
function teamStatsValue(row, field) {
  return row?.[field] === null || row?.[field] === undefined ? '' : String(row[field]);
}
function resetTeamStatsEditor(gameId, row) {
  teamStatsEditor.gameId = gameId;
  teamStatsEditor.original = Object.fromEntries(teamStatsFields.map(([field]) => [field, teamStatsValue(row, field)]));
  teamStatsEditor.draft = { ...teamStatsEditor.original };
  teamStatsEditor.dirty = false;
  teamStatsEditor.saving = false;
  teamStatsEditor.status = '';
}
function teamStatsPatch() {
  return Object.fromEntries(teamStatsFields
    .filter(([field]) => teamStatsEditor.draft[field] !== teamStatsEditor.original[field])
    .map(([field]) => [field, teamStatsEditor.draft[field].trim() === '' ? null : Number(teamStatsEditor.draft[field])]));
}
function confirmTeamStatsDiscard() {
  if (!teamStatsEditor.dirty) return true;
  if (!window.confirm('You have unsaved Team Stats changes. Leave without saving?')) return false;
  teamStatsEditor.dirty = false;
  return true;
}
function validateTeamStatsDraft() {
  const values = teamStatsEditor.draft;
  for (const [field, value] of Object.entries(values)) {
    if (value.trim() !== '' && !/^\d+$/.test(value.trim())) throw new Error(`${field.replace(/_/g, ' ')} must be a whole number or blank.`);
    if (value.trim() !== '' && Number(value) > 2147483647) throw new Error(`${field.replace(/_/g, ' ')} is too large.`);
  }
  for (const [attempts, success, label] of [['power_play_chances', 'power_play_success', 'Power play'], ['penalty_kill_chances', 'penalty_kill_success', 'Penalty kill']]) {
    const attemptsValue = values[attempts].trim();
    const successValue = values[success].trim();
    if ((attemptsValue === '') !== (successValue === '')) throw new Error(`${label} opportunities and successes must both be recorded or both be blank.`);
    if (attemptsValue !== '' && Number(successValue) > Number(attemptsValue)) throw new Error(`${label} successes cannot exceed opportunities.`);
  }
}
function teamStatsTotal(row, side) {
  const periods = [`shots_${side}_p1`, `shots_${side}_p2`, `shots_${side}_p3`];
  return periods.every(field => row?.[field] !== null && row?.[field] !== undefined)
    ? periods.reduce((sum, field) => sum + Number(row[field]), 0)
    : null;
}
function teamStatsDisplayTotal(row, side) {
  const derived = teamStatsTotal(row, side);
  return derived === null ? (row?.[`shots_${side}`] ?? null) : derived;
}
function teamStatsInput(field, label, value, disabled = '') {
  return `<label class="team-stats-field">${escapeHtml(label)}<input type="number" min="0" step="1" inputmode="numeric" data-team-stat-field="${field}" aria-label="${escapeHtml(label)}" value="${escapeHtml(value)}"${disabled} /></label>`;
}
function teamStatsForm(game, row, canEditStats) {
  if (teamStatsEditor.gameId !== game.source_game_id) resetTeamStatsEditor(game.source_game_id, row);
  const totalFor = teamStatsDisplayTotal(row, 'for');
  const totalAgainst = teamStatsDisplayTotal(row, 'against');
  const totalForDerived = teamStatsTotal(row, 'for') !== null;
  const totalAgainstDerived = teamStatsTotal(row, 'against') !== null;
  const disabled = !canEditStats || teamStatsEditor.saving ? ' disabled' : '';
  return `<section class="team-stats-editor" data-team-stats-editor>
    <div class="card-title"><h2>Team Stats</h2><span class="tag">${canEditStats ? 'Editable' : 'View only'}</span></div>
    <p class="sub">Enter only what was recorded. Blank means unrecorded; <strong>0</strong> means an explicit zero.</p>
    <div class="team-stats-total-grid"><div><small>Shots for</small><strong>${totalFor === null ? 'Not enough data yet' : totalFor}</strong><span>${totalForDerived ? 'Server-derived from P1 + P2 + P3' : 'Historical total preserved by server'}</span></div><div><small>Shots against</small><strong>${totalAgainst === null ? 'Not enough data yet' : totalAgainst}</strong><span>${totalAgainstDerived ? 'Server-derived from P1 + P2 + P3' : 'Historical total preserved by server'}</span></div></div>
    <div class="team-stats-grid">${teamStatsFields.slice(0, 8).map(([field, label]) => teamStatsInput(field, label, teamStatsEditor.draft[field], disabled)).join('')}</div>
    <div class="callout team-stats-ot-note"><strong>OT applicability is unresolved.</strong> Optional OT shots are stored as raw period entries only and never make a total authoritative or prove that overtime occurred.</div>
    <div class="team-stats-grid">${teamStatsFields.slice(8, 14).map(([field, label]) => teamStatsInput(field, label, teamStatsEditor.draft[field], disabled)).join('')}</div>
    <div class="team-stats-actions">${canEditStats ? `<button class="btn primary" type="button" data-save-team-stats${disabled}>Save Team Stats</button>` : ''}<span class="coach-form-status" data-team-stats-status role="status" aria-live="polite">${escapeHtml(teamStatsEditor.status)}</span></div>
  </section>`;
}
let selectedPlayerId = '';
let statsActiveTab = 'overview';
function gameCenter() {
  const teamStats = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  const games = window.PuckGameVisibility.activeGames(phase1Data?.schedule, phase1Data?.games).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const canEditStats = can(PERMISSIONS.STATS_EDIT, activeStaff);
  const today = new Date().toLocaleDateString('en-CA');
  const isPlayed = game => teamStats.has(game.source_game_id);
  const playedCount = games.filter(isPlayed).length;
  const game = games.find(g => g.source_game_id === selectedGameId) || games.find(g => String(g.date) <= today) || games[0];
  if (!game) return shell('Game Center', 'Prepare. Record. Review.', '<section class="card empty-view"><h2>Your season starts here</h2><p>No completed games are synced. Add a game to the schedule to bring its score, players, stats and film together.</p><button class="btn primary" data-workspace-goto="schedule">View schedule</button></section>');
  selectedGameId = game.source_game_id;
  const stats = teamStats.get(game.source_game_id);
  const hasScore = stats?.goals_for != null && stats?.goals_against != null;
  const eligible = String(game.date) <= today;
  const result = hasScore ? stats.goals_for > stats.goals_against ? 'WIN' : stats.goals_for < stats.goals_against ? 'LOSS' : 'TIE' : eligible ? 'NOT SCORED' : 'SCHEDULED';
  const playerRows = (phase1Data?.playerStats || []).filter(row => row.source_game_id === game.source_game_id);
  const scheduleRow = (phase1Data?.schedule || []).find(row => row.linked_game_source_id === game.source_game_id);
  const canRemoveDuplicate = Boolean(scheduleRow && can(PERMISSIONS.SCHEDULE_EDIT, activeStaff) && can(PERMISSIONS.STATS_VIEW, activeStaff) && can(PERMISSIONS.FILM_VIEW, activeStaff));
  const roster = window.PuckWorkspace.sortRoster(phase1Data?.roster || []);
  const rowsByPlayer = new Map(playerRows.map(row => [row.source_player_id, row]));
  const metric = (label, value) => `<div class="game-metric"><small>${label}</small><strong>${value == null ? '—' : escapeHtml(value)}</strong></div>`;
  const playerTable = type => {
    const players = roster.filter(p => (window.PuckWorkspace.position(p) === 'G') === (type === 'goalie'));
    const headers = type === 'goalie' ? ['Saves', 'GA', 'SA', 'SV%'] : ['Position', 'G', 'A', 'S', 'PTS', '+/−'];
    return `<div class="table-wrap"><table class="data-table game-player-table"><thead><tr>${['Player', ...headers].map((label, index) => `<th><button type="button" class="table-sort" data-game-sort="${index}" aria-label="Sort by ${escapeHtml(label)}">${escapeHtml(label)} <span aria-hidden="true">↕</span></button></th>`).join('')}</tr></thead><tbody>${players.map(p => {
      const row = rowsByPlayer.get(p.source_player_id);
      const derived = coachQol.derivedGoalie(row);
      const values = type === 'goalie' ? [row?.saves, row?.goals_against, row ? derived.shotsAgainst : null, row && derived.savePct !== null ? (derived.savePct * 100).toFixed(1) + '%' : null] : [p.position, row?.goals, row?.assists, row?.shots, row ? phase1Number(row.goals) + phase1Number(row.assists) : null, row?.plus_minus];
      return `<tr><td data-sort-value="${escapeHtml(p.name)}"><span class="jersey">#${escapeHtml(p.jersey_number)}</span> ${escapeHtml(p.name)}</td>${values.map(v => `<td data-sort-value="${v == null ? '' : escapeHtml(v)}">${v == null ? '—' : escapeHtml(v)}</td>`).join('')}</tr>`;
    }).join('') || `<tr><td colspan="${headers.length + 1}">No players in this group.</td></tr>`}</tbody></table></div>`;
  };
  const gameLeaders = roster.filter(p => window.PuckWorkspace.position(p) !== 'G' && rowsByPlayer.has(p.source_player_id)).map(p => ({player:p, row:rowsByPlayer.get(p.source_player_id)})).sort((a,b) => (phase1Number(b.row.goals)+phase1Number(b.row.assists)) - (phase1Number(a.row.goals)+phase1Number(a.row.assists))).slice(0,3);
  const comparison = (label, ours, theirs) => {
    const known = ours != null && theirs != null;
    const sum = known ? phase1Number(ours) + phase1Number(theirs) : 0;
    return `<div class="match-comparison"><div><strong>${ours == null ? '—' : escapeHtml(ours)}</strong><span>${label}</span><strong>${theirs == null ? '—' : escapeHtml(theirs)}</strong></div><div class="comparison-track" aria-hidden="true" ${known ? '' : 'hidden'}><i style="width:${sum ? Math.max(0, Math.min(100, phase1Number(ours)/sum*100)) : 50}%"></i></div></div>`;
  };
  const reviewPanels = `<div class="game-review-grid"><section class="card game-leaders">${cardTitle('Points leaders', 'This game')}<div class="performer-list">${gameLeaders.map(({player:p,row},index) => `<div class="performer"><span class="performer-number">${escapeHtml(p.jersey_number)}</span><div><small>${escapeHtml(p.position)} <b>·</b> ${index === 0 ? 'POINTS LEADER' : 'GAME CONTRIBUTOR'}</small><strong>${escapeHtml(p.name)}</strong><span>${phase1Number(row.goals)} G <b>·</b> ${phase1Number(row.assists)} A <b>·</b> ${phase1Number(row.shots)} SOG</span></div><div class="performer-points"><strong>${phase1Number(row.goals)+phase1Number(row.assists)}</strong><small>PTS</small></div></div>`).join('') || '<p class="sub">Player leaders appear once game stats are recorded.</p>'}</div></section><section class="card game-comparison">${cardTitle('Head to head', 'Recorded totals')}<div class="comparison-key"><span>Our team</span><span>Opponent</span></div>${comparison('Shots on goal',stats?.shots_for,stats?.shots_against)}${comparison('Goals',stats?.goals_for,stats?.goals_against)}<p class="comparison-note">${stats?.faceoff_wins != null && stats?.faceoff_losses != null && phase1Number(stats.faceoff_wins)+phase1Number(stats.faceoff_losses)>0 ? `${Math.round(phase1Number(stats.faceoff_wins)/(phase1Number(stats.faceoff_wins)+phase1Number(stats.faceoff_losses))*100)}% faceoffs won · ${escapeHtml(stats.faceoff_wins)} wins / ${escapeHtml(stats.faceoff_losses)} losses` : 'Faceoff breakdown awaits recorded data.'}</p></section></div>`;
  const filmPanel = `<section class="game-film-panel"><div class="card-title"><h2>Film</h2><span class="tag">Game-scoped film room</span></div><p class="sub">Review clips and uploads linked to this game in the existing Film Room workspace.</p><button class="btn" type="button" data-open-film-room="${escapeHtml(game.id)}">Open Film Room</button></section>`;
  const scoreForm = canEditStats && eligible ? `<details class="workspace-disclosure"><summary>${hasScore ? 'Correct final score' : 'Enter final score'}</summary><form class="score-entry" data-score-form><input type="hidden" name="gameId" value="${escapeHtml(game.source_game_id)}"><label>Us<input name="goalsFor" type="number" min="0" step="1" required value="${hasScore ? escapeHtml(stats.goals_for) : ''}"></label><span>–</span><label>Them<input name="goalsAgainst" type="number" min="0" step="1" required value="${hasScore ? escapeHtml(stats.goals_against) : ''}"></label><button class="btn primary" data-score-save>Save Score</button><span class="coach-form-status" data-score-status role="status" aria-live="polite"></span></form></details>` : '';
  return shell('Game Center', `${playedCount} of ${games.length} games played`, `
    <div class="game-toolbar"><label>Choose game<select id="gameSelect">${games.map(g => `<option value="${escapeHtml(g.source_game_id)}"${g === game ? ' selected' : ''}>${escapeHtml(phase1Date(g.date))} · ${escapeHtml(g.opponent)}</option>`).join('')}</select></label><button class="btn" data-workspace-goto="schedule">Full schedule ↗</button>${canRemoveDuplicate ? `<button class="btn danger" type="button" data-remove-duplicate="${escapeHtml(scheduleRow.id)}">Remove duplicate</button>` : ''}</div>
    <article class="card game-hub arena-panel"><div class="match-meta"><span class="eyebrow">THE GAME ROOM <b>/</b> ${escapeHtml(tenantSeasonName())}</span><span>${escapeHtml(phase1Date(game.date))} · ${escapeHtml(game.period_length_min ? game.period_length_min + '-minute periods' : 'Game review')}</span></div><div class="matchup"><div class="match-team">${window.PuckWorkspace.crest(tenantName(), seasonContext.branding?.logo_url)}<div><small>YOUR TEAM</small><h2>${escapeHtml(tenantName())}</h2></div></div><div class="game-hub-score"><span class="result ${result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : ''}">${result}</span><strong>${hasScore ? `${escapeHtml(stats.goals_for)}<span>–</span>${escapeHtml(stats.goals_against)}` : '— : —'}</strong><small>${hasScore ? 'Final score' : eligible ? 'Score unavailable' : 'Not yet played'}</small></div><div class="match-team opponent-team">${window.PuckWorkspace.crest(game.opponent)}<div><small>OPPONENT</small><h2>${escapeHtml(game.opponent)}</h2></div></div></div>
    <div class="game-hub-actions">${canEditStats && eligible ? `<button class="btn primary" data-enter-stats="${escapeHtml(game.source_game_id)}">${playerRows.length ? 'Edit Stats' : 'Enter Stats'}</button>` : `<span class="tag">${eligible ? 'Read only' : 'Stat entry opens on game day'}</span>`}${can(PERMISSIONS.FILM_VIEW, activeStaff) ? `<button class="btn" data-open-film-room="${escapeHtml(game.id)}">Film Room</button>` : ''}<span class="sub">${playerRows.length ? `${playerRows.length} player stat records` : 'Player stats not entered'}</span></div></article>
    ${canEditStats ? '<section class="card" id="coachStatsHost" hidden></section>' : ''}
    <nav class="workspace-tabs game-center-tabs" aria-label="Game sections">${[['overview', 'Overview'], ['team-stats', 'Team Stats'], ['players', 'Players'], ['goalies', 'Goalies'], ['film', 'Film']].map(([id, label]) => `<button type="button" data-game-tab="${id}" aria-pressed="${gameWorkspaceTab === id}" class="${gameWorkspaceTab === id ? 'active' : ''}">${label}</button>`).join('')}</nav>
    <section class="card game-detail">${gameWorkspaceTab === 'team-stats' ? teamStatsForm(game, stats, canEditStats) : gameWorkspaceTab === 'players' ? cardTitle('Players', 'Position → jersey number') + playerTable('skater') : gameWorkspaceTab === 'goalies' ? cardTitle('Goalies', 'Game totals') + playerTable('goalie') : gameWorkspaceTab === 'film' ? filmPanel : `${cardTitle('Game at a glance', hasScore ? 'Recorded totals' : 'Awaiting game data')}<div class="game-metrics">${metric('Shots for', stats?.shots_for)}${metric('Shots against', stats?.shots_against)}${metric('Power play', stats?.power_play_chances != null ? `${stats.power_play_success ?? '—'} / ${stats.power_play_chances}` : null)}${metric('Faceoffs won', stats?.faceoff_wins)}</div>${!hasScore || !playerRows.length ? '<p class="game-data-note">Finish this game: '+ (!hasScore ? 'add the final score. ' : '') + (!playerRows.length ? 'Enter player stats to complete the review.' : '') + '</p>' : ''}${scoreForm}<details class="workspace-disclosure"><summary>About this game data</summary><p class="sub">A dash means a value has not been recorded. Player stats and the final score save separately. Detailed shifts, shot locations, faceoff locations and game notes remain available in the Windows workspace.</p></details>`}</section>${gameWorkspaceTab === 'overview' ? reviewPanels : ''}`);
}

function bindTeamStatsEditor() {
  const editor = document.querySelector('[data-team-stats-editor]');
  if (!editor) return;
  editor.querySelectorAll('[data-team-stat-field]').forEach(input => input.addEventListener('input', event => {
    teamStatsEditor.draft[event.currentTarget.dataset.teamStatField] = event.currentTarget.value;
    teamStatsEditor.dirty = Object.keys(teamStatsPatch()).length > 0;
    const status = editor.querySelector('[data-team-stats-status]');
    if (status) { status.textContent = teamStatsEditor.dirty ? 'Unsaved changes' : ''; status.className = 'coach-form-status'; }
  }));
  editor.querySelector('[data-save-team-stats]')?.addEventListener('click', async event => {
    const status = editor.querySelector('[data-team-stats-status]');
    try {
      validateTeamStatsDraft();
      const payload = teamStatsPatch();
      if (!Object.keys(payload).length) {
        teamStatsEditor.status = 'No changes to save.';
        status.textContent = teamStatsEditor.status;
        return;
      }
      teamStatsEditor.saving = true;
      event.currentTarget.disabled = true;
      event.currentTarget.textContent = 'Saving…';
      status.textContent = '';
      const { error } = await supabaseClient.rpc('save_game_team_stats', {
        target_team_id: authTeam.team_id,
        target_season_id: seasonContext.selectedSeasonId,
        target_source_game_id: teamStatsEditor.gameId,
        payload
      });
      if (error) throw new Error(error.message || 'Team Stats could not be saved.');
      teamStatsEditor.dirty = false;
      teamStatsEditor.status = 'Team Stats saved.';
      await loadPhase1Data(authTeam.team_id);
      teamStatsEditor.saving = false;
      render('games');
    } catch (error) {
      teamStatsEditor.saving = false;
      teamStatsEditor.status = error.message || 'Team Stats could not be saved.';
      status.textContent = teamStatsEditor.status;
      status.className = 'coach-form-status err';
      event.currentTarget.disabled = false;
      event.currentTarget.textContent = 'Save Team Stats';
    }
  });
}
function bindCoachStatsControls() {
  const host = document.querySelector('#coachStatsHost');
  if (!host) return;
  document.querySelectorAll('[data-enter-stats]').forEach(button => button.addEventListener('click', () => {
    if (coachQol.saveState === coachQol.SAVE_STATES.SAVING) return;
    if (coachQol.dirty && !window.confirm('Discard unsaved stat changes?')) return;
    const gameId = button.dataset.enterStats;
    const game = (phase1Data?.games || []).find(g => g.source_game_id === gameId);
    const skaters = (phase1Data?.playerStats || []).filter(s => s.source_game_id === gameId && s.player_type === 'skater');
    const goalies = (phase1Data?.playerStats || []).filter(s => s.source_game_id === gameId && s.player_type === 'goalie');
    coachQol.openGame(gameId, skaters, goalies);
    host.hidden = false;
    host.innerHTML = `<div class="card-title"><h2>Enter stats · ${escapeHtml(game?.opponent || gameId)} · ${phase1Date(game?.date)}</h2><button class="btn" type="button" data-close-stats>Close</button></div>${coachQol.statsWorkspaceHtml(phase1Data?.roster || [], skaters, goalies)}`;
    host.querySelector('[data-coach-goto]')?.addEventListener('click', () => render('players'));
    host.querySelectorAll('[data-player-absent]').forEach(absentButton => absentButton.addEventListener('click', () => {
      const absent = absentButton.getAttribute('aria-pressed') !== 'true';
      try {
        const row = coachQol.setAbsent(absentButton.dataset.playerType, absentButton.dataset.playerAbsent, absent);
        absentButton.setAttribute('aria-pressed', String(absent));
        absentButton.textContent = absent ? 'Absent ✓' : 'Absent';
        [...host.querySelectorAll('.stat-input')].filter(input => input.dataset.statPlayer === absentButton.dataset.playerAbsent).forEach(input => {
          if (absent) input.value = '0';
          input.disabled = absent;
        });
        host.querySelector('[data-dirty-flag]').textContent = 'Unsaved changes';
        host.querySelector('[data-save-stats]').textContent = 'SAVE GAME STATS';
        host.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (error) { window.alert(error.message); }
    }));
    host.querySelector('[data-close-stats]').addEventListener('click', () => {
      if (coachQol.dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
      coachQol.openGame(null, [], []);
      host.hidden = true;
      host.innerHTML = '';
      button.focus();
    });
    host.querySelectorAll('.stat-input').forEach(input => input.addEventListener('input', () => {
      try {
        coachQol.setStat(input.dataset.statType, input.dataset.statPlayer, input.dataset.statField, input.value, input.getAttribute('aria-label'));
        input.setCustomValidity('');
      } catch (error) { input.setCustomValidity(error.message); input.reportValidity(); }
      const flag = host.querySelector('[data-dirty-flag]');
      if (flag) flag.textContent = 'Unsaved changes';
      host.querySelector('[data-save-stats]').textContent = 'SAVE GAME STATS';
    }));
    host.querySelectorAll('.stat-input').forEach(input => input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const inputs = Array.from(host.querySelectorAll('.stat-input'));
      inputs[inputs.indexOf(input) + 1]?.focus();
    }));
    host.querySelector('[data-save-stats]')?.addEventListener('click', async event => {
      const invalid = [...host.querySelectorAll('.stat-input')].find(input => !input.checkValidity());
      if (invalid) { host.querySelector('[data-mode="bulk"]')?.click(); invalid.reportValidity(); return; }
      const saveButton = event.currentTarget;
      const controls = [...host.querySelectorAll('button, input')];
      const priorDisabled = controls.map(control => control.disabled);
      controls.forEach(control => { control.disabled = true; });
      const status = host.querySelector('[data-stats-status]');
      saveButton.disabled = true;
      saveButton.textContent = 'Saving…';
      status.textContent = '';
      status.className = 'coach-form-status';
      try {
        await coachQol.saveStats();
        controls.forEach((control, index) => { control.disabled = priorDisabled[index]; });
        saveButton.disabled = false;
        host.querySelector('[data-undo-stat]')?.setAttribute('disabled', '');
        const flag = host.querySelector('[data-dirty-flag]');
        if (flag) flag.textContent = 'All changes saved';
        if (!host.isConnected) {
          const confirmation = document.createElement('p');
          confirmation.className = 'save-confirmation';
          confirmation.setAttribute('role', 'status');
          confirmation.textContent = 'Game stats saved.';
          app.querySelector('.game-hub')?.after(confirmation);
        }
        saveButton.textContent = '✓ Stats Saved';
        status.textContent = 'Stats saved.';
        status.classList.add('ok');
      } catch (error) {
        controls.forEach((control, index) => { control.disabled = priorDisabled[index]; });
        saveButton.disabled = false;
        saveButton.textContent = 'Save failed — Retry';
        status.textContent = 'Stats could not be saved — your changes are still on screen. Retry.';
        status.classList.add('err');
      }
    });
    window.PuckWorkspace.bindQuickEntry(host, phase1Data?.roster || [], coachQol);
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
    return `<article class="card opponent-scout-card"><span class="eyebrow">OPPONENT FILE</span><div class="card-title"><h2>${escapeHtml(profile.opponent_name)}</h2><span class="tag">${players.length} player${players.length === 1 ? '' : 's'}</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Number</th><th>Position</th><th>Source</th></tr></thead><tbody>${players.map(player => `<tr><td>${escapeHtml(player.player_name || 'Unknown')}</td><td>${escapeHtml(player.jersey_number || 'Unknown')}</td><td>${escapeHtml(player.position || 'Unknown')}</td><td>${escapeHtml(player.source_kind || 'Local source')}</td></tr>`).join('') || '<tr><td colspan="4">No opponent players are recorded for this profile.</td></tr>'}</tbody></table></div></article>`;
  }).join('');
  return shell('Scouting', 'Verified opponent identities only. Private scouting notes and evaluations are not synced in this phase.', `<div class="callout"><strong>${phase2AData.profiles.length} opponent profiles · ${phase2AData.players.length} opponent players</strong><br>Names, jersey numbers, and positions are shown exactly as stored. Missing positions remain Unknown.</div><div class="scouting-grid">${cards || '<section class="card polish-empty scouting-empty"><span class="eyebrow">THE NEXT OPPONENT. A CLEARER PLAN.</span><h2>Prepare. Identify tendencies.<br>Build the game plan.</h2><p>No opponent profiles are available for this team yet. Verified opponent identities appear here when synced from the Windows app.</p><div class="polish-steps"><article><strong>Know the opponent</strong><p>Bring names, numbers and positions into view.</p></article><article><strong>Prepare with context</strong><p>Review the verified roster before game day.</p></article></div><span class="tag">Read-only opponent directory</span></section>'}</div>`);
}
function reports() {
  return shell('Coach Reports', 'The next chapter in your team’s story. Coming soon to the web.', '<section class="card polish-empty reports-empty"><span class="tag">Coming soon · Not available on web</span><span class="eyebrow">FROM THE BENCH TO THE BIG PICTURE</span><h2>A clearer story.<br>Every game. Every player.</h2><p>Reports are not synced yet. Generated reports remain local to the Windows app. The planned web reporting direction brings coaching insights together:</p><div class="polish-steps"><article><span>01 / POSTGAME</span><h3>Coach reports</h3><p>The game in perspective.</p></article><article><span>02 / DEVELOPMENT</span><h3>Player summaries</h3><p>Progress across the season.</p></article><article><span>03 / PERFORMANCE</span><h3>Team reporting</h3><p>A shared view of the team.</p></article></div><p class="polish-footnote">Planned categories, not available features. Continue using reports in the Windows app.</p></section>');
}
function development() {
  return shell('Player Development', 'A read-only workspace shell for future development records.', '<section class="card workspace-shell"><div class="workspace-icon">↗</div><h2>Development records are not synced yet</h2><p>Private evaluations and development notes remain protected in the Windows app. This web surface will stay empty until an approved, team-scoped cloud model exists.</p><span class="tag">No cloud data available</span></section>');
}
function settings() {
  return shell('Team Settings', 'Your team identity, workspace and access.', `${window.PuckTeamBranding.markup()}<details class="settings-context"><summary>Workspace context &amp; data policy</summary><div class="settings-grid"><section class="card settings-card"><div class="card-title"><h2>Workspace context</h2><span class="tag">Read only</span></div><dl class="settings-list"><div><dt>Platform</dt><dd>${escapeHtml(PLATFORM.name)}</dd></div><div><dt>Team</dt><dd>${escapeHtml(tenantName())}</dd></div><div><dt>Season</dt><dd>${escapeHtml(tenantSeasonName())}</dd></div><div><dt>Role</dt><dd>${escapeHtml(activeStaff?.role || 'Authenticated team member')}</dd></div><div><dt>Platform access</dt><dd>${escapeHtml(platformAccess.isPlatformAdmin ? `PuckNexus ${platformAccess.roles.join(' + ') || 'platform_admin'}` : 'Team workspace only')}</dd></div></dl></section><section class="card settings-card"><div class="card-title"><h2>Data policy</h2><span class="tag">Team access</span></div><p class="settings-copy">This browser workspace reads authorized team data through Supabase RLS. Local video, TOI, tracking, vault, backups, and device settings remain in the Windows app.</p><span class="permission-lock">${authCapabilities.length} database-provided capabilities loaded</span></section></div></details>`);
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
  window.PuckTeamBranding.apply(seasonContext.branding, lastRenderedView || 'command');
  const seasonName = tenantSeasonName();
  const mark = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'PN';
  const tenantMark = document.querySelector('#tenantMark');
  const tenantNameNode = document.querySelector('#tenantName');
  const tenantSeasonLabel = document.querySelector('#tenantSeasonLabel');
  const tenantFooter = document.querySelector('#tenantFooter');
  const teamStatus = document.querySelector('#teamStatus');
  if (tenantMark) tenantMark.innerHTML = window.PuckWorkspace.crest(displayName, seasonContext.branding?.logo_url);
  document.querySelector('#tenantSecondary')?.remove();
  const secondaryLogo = window.PuckTeamBranding.safeImage(seasonContext.branding?.settings?.secondary_image_url);
  if (secondaryLogo && tenantFooter) { const image = document.createElement('img'); image.id = 'tenantSecondary'; image.className = 'tenant-secondary'; image.alt = displayName + ' secondary logo'; image.src = secondaryLogo; image.loading = 'lazy'; tenantFooter.after(image); }
  if (tenantNameNode) {
    tenantNameNode.textContent = displayName;
    document.querySelector('#tenantWordmark')?.remove();
    const wordmark = window.PuckTeamBranding.safeImage(seasonContext.branding?.settings?.wordmark_url);
    if (wordmark) { const image = document.createElement('img'); image.id = 'tenantWordmark'; image.className = 'tenant-wordmark'; image.alt = displayName + ' wordmark'; image.src = wordmark; tenantNameNode.before(image); }
  }
  if (tenantSeasonLabel) tenantSeasonLabel.textContent = seasonName;
  if (tenantFooter) tenantFooter.textContent = displayName;
  if (teamStatus) teamStatus.textContent = `${displayName} · ${activeStaff?.role || 'Team workspace'}`;
}

async function selectTeam(teamId) {
  if (!window.PuckTeamBranding.canLeave()) { renderTeamSwitcher(); return; }
  if (coachQol.saveState === coachQol.SAVE_STATES.SAVING) { renderTeamSwitcher(); return; }
  if (!confirmTeamStatsDiscard()) { renderTeamSwitcher(); return; }
  if (coachQol.dirty && !window.confirm('You have unsaved stats. Leave without saving?')) { renderTeamSwitcher(); return; }
  coachQol.openGame(null, [], []);
  selectedGameId = '';
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
  if (coachQol.saveState === coachQol.SAVE_STATES.SAVING) { renderSeasonSwitcher(); return; }
  if (!confirmTeamStatsDiscard()) { renderSeasonSwitcher(); return; }
  if (coachQol.dirty && !window.confirm('You have unsaved stats. Leave without saving?')) { renderSeasonSwitcher(); return; }
  coachQol.openGame(null, [], []);
  selectedGameId = '';
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
  userMenu.querySelector('[data-platform-admin]')?.remove();
  if (platformAccess.isPlatformAdmin) {
    const adminButton = document.createElement('button');
    adminButton.type = 'button';
    adminButton.className = 'btn';
    adminButton.dataset.platformAdmin = 'true';
    adminButton.textContent = 'Platform Admin';
    adminButton.onclick = () => {
      if (coachQol.saveState === coachQol.SAVE_STATES.SAVING) return;
      if (coachQol.dirty && !window.confirm('You have unsaved stats. Leave without saving?')) return;
      coachQol.openGame(null, [], []);
      closeActionCenter();
      showPlatformLanding(activeStaff.name, teamContext.memberships.length > 0);
    };
    userMenu.appendChild(adminButton);
  }

  if (!userMenu.querySelector('.signout-button')) {
    const button = document.createElement('button');
    button.className = 'signout-button';
    button.type = 'button';
    button.textContent = 'Sign out';
    button.onclick = signOut;
    userMenu.appendChild(button);
  }
}
function actionItems() {
  return ActionCenter.actionableItems({
    roster: phase1Data?.roster || [], schedule: phase1Data?.schedule || [],
    playerStats: phase1Data?.playerStats || [], teamStats: phase1Data?.teamStats || [],
    capabilities: authCapabilities
  });
}
function renderActionCenter() {
  const button = document.querySelector('#actionCenterButton');
  const badge = document.querySelector('#actionCenterBadge');
  if (!button || !badge) return;
  const count = actionItems().length;
  badge.hidden = count === 0;
  badge.textContent = String(count);
  button.disabled = count === 0;
}
function closeActionCenter() {
  const panel = document.querySelector('#actionCenter');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  document.querySelector('#actionCenterButton')?.setAttribute('aria-expanded', 'false');
  actionCenterReturnFocus?.focus();
}
function openActionCenter() {
  const panel = document.querySelector('#actionCenter');
  const button = document.querySelector('#actionCenterButton');
  const items = actionItems();
  if (!panel || !items.length) return;
  actionCenterReturnFocus = button;
  panel.innerHTML = `<div class="action-center-head"><h2>Action Center</h2><button class="btn" type="button" data-close-action-center>Close</button></div>${items.map(item => `<button class="action-center-item" type="button" data-action-center-view="${escapeHtml(item.view)}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span></button>`).join('')}`;
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  button?.setAttribute('aria-expanded', 'true');
  panel.querySelector('[data-close-action-center]').addEventListener('click', closeActionCenter);
  panel.querySelectorAll('[data-action-center-view]').forEach(item => item.addEventListener('click', () => {
    closeActionCenter();
    render(item.dataset.actionCenterView);
  }));
  panel.querySelector('[data-close-action-center]').focus();
}
function render(view = 'command') {
  if (lastRenderedView === 'settings' && !window.PuckTeamBranding.canLeave()) return false;
  if (coachQol.saveState === coachQol.SAVE_STATES.SAVING) return false;
  if (lastRenderedView === 'games' && !confirmTeamStatsDiscard()) return false;
  if (coachQol.dirty && lastRenderedView === 'games') {
    if (!window.confirm('You have unsaved stats. Leave without saving?')) return false;
    coachQol.openGame(null, [], []);
  }
  if (!can(roleViews[view], activeStaff)) view = 'command';
  const sameView = view === lastRenderedView;
  const dashboardExpanded = document.querySelector('.dashboard-depth')?.open;
  const preservedScroll = sameView ? window.scrollY : 0;
  const page = view === 'scouting'
    ? scouting()
    : phase1DataError
      ? shell('Team data unavailable', 'The authenticated workspace is available, but the live team data could not be read.', `<section class="card empty-view"><div class="empty-icon">!</div><h2>Unable to load synced team data</h2><p>${escapeHtml(phase1DataError)}</p><button class="btn primary" id="retryPhase1Data" type="button">Retry</button></section>`)
      : !phase1Data
        ? shell('Loading team data', 'Reading the live team roster, schedule, games, and stats…', '<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Loading synced team data</h2><p>Please wait while the secure workspace reads your team data.</p></section>')
        : view === 'command' ? command() : view === 'schedule' ? schedule() : view === 'stats' ? stats() : view === 'players' ? players() : view === 'games' ? gameCenter() : view === 'film' ? (filmRoom.render(), '') : view === 'reports' ? reports() : view === 'development' ? development() : view === 'settings' ? settings() : view === 'admin' ? admin() : generic(view);
  app.innerHTML = page;
  if (sameView && dashboardExpanded && document.querySelector('.dashboard-depth')) document.querySelector('.dashboard-depth').open = true;
  document.querySelector('#viewCrumb').textContent = viewNames[view]; renderRoleSwitcher();
  renderTeamSwitcher();
  renderSeasonSwitcher();
  renderTenantBranding();
  renderActionCenter();
  const seasonPill = document.querySelector('#seasonPill');
  if (seasonPill) seasonPill.firstChild.textContent = tenantSeasonName();
  document.querySelector('#retryPhase1Data')?.addEventListener('click', () => loadPhase1Data(authTeam.team_id));
  document.querySelector('#retryPhase2AData')?.addEventListener('click', () => loadPhase2AData(authTeam.team_id));
  window.PuckTeamBranding.apply(seasonContext.branding, view);
  if (view === 'settings') window.PuckTeamBranding.mount(document.querySelector('#brandEditor'), {
    client: supabaseClient,
    getContext: () => ({membership:authTeam, capabilities:authCapabilities, userId:authUser?.id, organizationId:authTeam?.teams?.organization_id}),
    onSaved: async branding => { seasonContext.branding = branding; renderTenantBranding(); window.PuckTeamBranding.apply(branding, 'settings'); }
  });
  if (view === 'admin') bindAdminControls();
  if (view === 'schedule') bindCoachGameControls();
  if (view === 'players') {
    bindCoachRosterControls();
    if (selectedPlayerId) {
      document.querySelector(`[data-player-row="${CSS.escape(selectedPlayerId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
  if (view === 'stats') bindStatsControls();
  if (view === 'games') {
    bindCoachStatsControls();
    if (typeof bindTeamStatsEditor === 'function') bindTeamStatsEditor();
    document.querySelector('[data-remove-duplicate]')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const game = (phase1Data?.games || []).find(row => row.source_game_id === selectedGameId);
      if (!game || !can(PERMISSIONS.SCHEDULE_EDIT, activeStaff) || !can(PERMISSIONS.STATS_VIEW, activeStaff) || !can(PERMISSIONS.FILM_VIEW, activeStaff)) return;
      button.disabled = true;
      try {
        const [scheduleCheck, playerCheck, teamCheck, filmCheck] = await Promise.all([
          supabaseClient.from('team_schedule_games').select('id,linked_game_source_id').eq('id', button.dataset.removeDuplicate).eq('team_id', authTeam.team_id).maybeSingle(),
          supabaseClient.from('team_game_player_stats').select('id').eq('team_id', authTeam.team_id).eq('source_game_id', game.source_game_id).limit(1),
          supabaseClient.from('team_game_team_stats').select('id').eq('team_id', authTeam.team_id).eq('source_game_id', game.source_game_id).limit(1),
          supabaseClient.from('team_film').select('id').eq('team_id', authTeam.team_id).eq('game_id', game.id).limit(1)
        ]);
        if ([scheduleCheck, playerCheck, teamCheck, filmCheck].some(result => result.error)) throw new Error('Dependent game data could not be verified. Nothing was removed.');
        if (scheduleCheck.data?.linked_game_source_id !== game.source_game_id) throw new Error('The schedule link changed. Refresh and try again.');
        if (playerCheck.data?.length || teamCheck.data?.length || filmCheck.data?.length) throw new Error('This game has stats or film. Review its records before removing the schedule link.');
        if (!window.confirm(`Remove ${game.date} vs ${game.opponent} from Schedule and Game Center? This keeps the underlying game record for safety.`)) return;
        await coachQol.deleteGame(scheduleCheck.data.id);
        selectedGameId = '';
      } catch (error) { window.alert(error.message || 'The duplicate could not be removed.'); }
      finally { button.disabled = false; }
    });
    document.querySelectorAll('.game-player-table').forEach(table => table.querySelectorAll('[data-game-sort]').forEach(button => button.addEventListener('click', () => {
      const column = Number(button.dataset.gameSort);
      const heading = button.closest('th');
      const numeric = column > 1 || (table.querySelectorAll('[data-game-sort]').length === 5 && column > 0);
      const ascending = heading.getAttribute('aria-sort') === 'descending' || (!heading.hasAttribute('aria-sort') && !numeric);
      const tbody = table.tBodies[0];
      const rows = [...tbody.rows].filter(row => row.cells.length > 1);
      rows.sort((left, right) => {
        const a = left.cells[column]?.dataset.sortValue || '';
        const b = right.cells[column]?.dataset.sortValue || '';
        if (a === '') return 1;
        if (b === '') return -1;
        const order = numeric ? Number(a.replace('%', '')) - Number(b.replace('%', '')) : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        return (ascending ? 1 : -1) * order;
      });
      rows.forEach(row => tbody.appendChild(row));
      table.querySelectorAll('th').forEach(th => th.removeAttribute('aria-sort'));
      heading.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
      button.querySelector('span').textContent = ascending ? '↑' : '↓';
    })));
    document.querySelector('#gameSelect')?.addEventListener('change', event => {
      const previous = selectedGameId;
      selectedGameId = event.target.value;
      if (render('games') === false) { selectedGameId = previous; event.target.value = previous; }
    });
    document.querySelectorAll('[data-game-tab]').forEach(button => button.addEventListener('click', () => {
      const previous = gameWorkspaceTab;
      gameWorkspaceTab = button.dataset.gameTab;
      if (render('games') === false) gameWorkspaceTab = previous;
      else document.querySelector(`[data-game-tab="${gameWorkspaceTab}"]`)?.focus({ preventScroll: true });
    }));
    document.querySelectorAll('[data-score-form]').forEach(form => form.addEventListener('submit', event => { event.preventDefault(); if (coachQol.saveState === coachQol.SAVE_STATES.SAVING) return; if (coachQol.dirty) { if (!window.confirm('Discard unsaved player stats before saving the score?')) return; coachQol.openGame(null, [], []); } coachQol.submitScoreForm(form); }));
  }
  document.querySelectorAll('[data-workspace-goto]').forEach(button => button.addEventListener('click', () => render(button.dataset.workspaceGoto)));
  if (view === 'games') document.querySelectorAll('[data-open-film-room]').forEach(button => button.addEventListener('click', () => { if (render('film') !== false) filmRoom.openForGame(button.dataset.openFilmRoom); }));
  if (view === 'film') {
    filmRoom.render();
    filmRoom.load().then(() => filmRoom.render());
  }
  if (view === 'command') bindDashboardControls();
  nav.forEach(item => { const allowed = can(roleViews[item.dataset.view], activeStaff); item.hidden = !allowed; item.classList.toggle('active', item.dataset.view === view); if (item.dataset.view === view) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
  document.querySelector('.nav-item.active')?.closest('details')?.setAttribute('open', '');
  document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#scrim').classList.remove('show');
  document.querySelector('#openSidebar').setAttribute('aria-expanded', 'false');
  syncNavigation();
  lastRenderedView = view;
  // Only a real view change resets the page to the top.
  window.scrollTo(0, sameView ? preservedScroll : 0);
}
window.addEventListener('beforeunload', event => { if (coachQol.dirty || teamStatsEditor.dirty) { event.preventDefault(); event.returnValue = ''; } });
nav.forEach(item => item.addEventListener('click', () => render(item.dataset.view)));
function setNavigation(open) {
  const sidebar = document.querySelector('#sidebar');
  const trigger = document.querySelector('#openSidebar');
  sidebar.classList.toggle('open', open);
  document.querySelector('#scrim').classList.toggle('show', open);
  trigger.setAttribute('aria-expanded', String(open));
  sidebar.inert = window.matchMedia('(max-width:900px)').matches && !open;
  if (open) document.querySelector('#closeSidebar').focus();
  else if (window.matchMedia('(max-width:900px)').matches) trigger.focus();
}
document.querySelector('#openSidebar').addEventListener('click', () => setNavigation(true));
document.querySelector('#closeSidebar').addEventListener('click', () => setNavigation(false));
document.querySelector('#scrim').addEventListener('click', () => setNavigation(false));
const mobileNavigation = window.matchMedia('(max-width:900px)');
function syncNavigation() { document.querySelector('#sidebar').inert = mobileNavigation.matches && !document.querySelector('#sidebar').classList.contains('open'); }
mobileNavigation.addEventListener('change', syncNavigation);
syncNavigation();
document.querySelector('#sidebar').addEventListener('keydown', event => {
  if (!mobileNavigation.matches) return;
  if (event.key === 'Escape') { event.preventDefault(); setNavigation(false); }
  if (event.key === 'Tab') {
    const buttons = [...event.currentTarget.querySelectorAll('button, summary')].filter(node => !node.hidden && node.getClientRects().length);
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
document.querySelector('#actionCenterButton').addEventListener('click', () => {
  if (document.querySelector('#actionCenter').hidden) openActionCenter();
  else closeActionCenter();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeActionCenter(); });
document.addEventListener('click', event => {
  const panel = document.querySelector('#actionCenter');
  const button = document.querySelector('#actionCenterButton');
  if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) closeActionCenter();
});
function showLoading() {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.removeAttribute('aria-hidden');
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="platform-lockup"><img src="./assets/pucknexus-official.png" alt="PuckNexus — THE BEST PUCKING ANALYTICS" width="1280" height="1280" /></div></div><h1>Restoring your session</h1><p class="auth-loading">Connecting to the secure team workspace…</p></div>`;
}

function authLanding(content, activeTab = 'signin') {
  const usaFlag = '<svg class="login-flag" viewBox="0 0 28 18" role="img" aria-label="USA flag"><path fill="#fff" d="M0 0h28v18H0z"/><path stroke="#cf243f" stroke-width="2" d="M0 1h28M0 5h28M0 9h28M0 13h28M0 17h28"/><path fill="#194878" d="M0 0h12v10H0z"/><path fill="#fff" d="M2 2h1v1H2zm4 0h1v1H6zm4 0h1v1h-1zM4 5h1v1H4zm4 0h1v1H8zM2 8h1v1H2zm4 0h1v1H6zm4 0h1v1h-1z"/></svg>';
  const canadaFlag = '<svg class="login-flag" viewBox="0 0 28 18" role="img" aria-label="Canada flag"><path fill="#fff" d="M0 0h28v18H0z"/><path fill="#e2233d" d="M0 0h7v18H0zm21 0h7v18h-7zM14 3l1 3 2-1-1 3 3 1-4 3v3h-2v-3l-4-3 3-1-1-3 2 1z"/></svg>';
  return `<div class="login-landing">
    <header class="login-header"><div class="login-logo platform-lockup"><img src="./assets/pucknexus-official.png" alt="PuckNexus — THE BEST PUCKING ANALYTICS — USA and Canada" width="1280" height="1280" fetchpriority="high" /></div>
      <nav class="login-nav" aria-label="PuckNexus"><a href="#login-features">Features</a><a href="#login-community">Our community</a></nav>
      <div class="login-header-actions"><button type="button" class="login-header-signin" id="headerSignIn">Sign In</button><button type="button" class="login-header-start" id="headerGetStarted">Get Started</button></div></header>
    <div class="login-countries">USA ${usaFlag} <span>|</span> CANADA ${canadaFlag}</div>
    <main class="login-main"><section class="login-story" aria-label="PuckNexus community"><div class="login-story-copy"><p>HOCKEY BUILDS MORE THAN PLAYERS</p><h2>IT BUILDS <span>PEOPLE.</span></h2><div>Analytics. Development. Community. A brighter path for every player.</div></div></section>
      <section class="login-panel" aria-label="Account access"><div class="login-tabs"><button type="button" id="loginTabSignIn" class="${activeTab === 'signin' ? 'active' : ''}" aria-current="${activeTab === 'signin' ? 'page' : 'false'}">Sign In</button><button type="button" id="loginTabSignUp" class="${activeTab === 'signup' ? 'active' : ''}" aria-current="${activeTab === 'signup' ? 'page' : 'false'}">Sign Up</button></div>${content}</section></main>
    <div class="login-lower"><section class="login-features" id="login-features"><div><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 40h38M9 34v6m8-13v13m8-21v21m8-10v10m8-26v26M8 22l12-8 9 2 12-11m-8 0h8v8"/></svg><strong>TEAM ANALYTICS</strong><p>Turn data into development.</p></div><div><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="12" width="27" height="24" rx="4"/><path d="M32 19l11-6v22l-11-6z"/></svg><strong>FILM ROOM</strong><p>See more. Learn more.</p></div><div><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="14" r="6"/><circle cx="10" cy="19" r="4"/><circle cx="38" cy="19" r="4"/><path d="M13 39v-6c0-6 5-10 11-10s11 4 11 10v6M2 36v-6c0-4 3-7 8-7m36 13v-6c0-4-3-7-8-7"/></svg><strong>TEAM HUB</strong><p>Everything in one place.</p></div><div><svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 39h38M8 32l11-11 8 5L42 9m-10 0h10v10M9 40V33m10 7V27m9 13V31m10 9V20"/></svg><strong>PLAYER DEVELOPMENT</strong><p>A brighter path for every player.</p></div><div><svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="8" width="32" height="36" rx="3"/><path d="M17 8V5h14v3M16 20h16M16 27h16M16 34h9m3-1l3 3 6-8"/></svg><strong>SCOUTING</strong><p>Be prepared. Be better.</p></div></section><section class="login-thanks" id="login-community"><span class="login-heart">♡</span><div><strong>Thank You</strong><small>TO OUR BETA TESTERS</small><p>Your feedback, support, and belief in PuckNexus are helping shape a stronger future for hockey.<br>We couldn't do this without you.</p></div><b>SAME GAME<br>HIGHER<br>STANDARDS</b></section></div>
    <footer class="login-footer"><div><strong>PUCK<span>NEXUS</span></strong><small>THE BEST PUCKING ANALYTICS</small></div><span>USA ${usaFlag} &nbsp; | &nbsp; CANADA ${canadaFlag}</span><span>BUILT BY THE HOCKEY COMMUNITY. FOR WHAT'S NEXT.</span></footer>
  </div>`;
}

function bindAuthLanding() {
  authScreen.querySelector('#headerSignIn')?.addEventListener('click', () => showLogin());
  authScreen.querySelector('#headerGetStarted')?.addEventListener('click', () => showSignUp());
  authScreen.querySelector('#loginTabSignIn')?.addEventListener('click', () => showLogin());
  authScreen.querySelector('#loginTabSignUp')?.addEventListener('click', () => showSignUp());
}

function showLogin(error = '', notice = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.removeAttribute('aria-hidden');
  authScreen.innerHTML = authLanding(`<h1>Welcome to Puck<span>Nexus</span></h1><p class="login-intro">Sign in to your account and get back to what matters.</p><form class="login-form" id="loginForm"><label class="login-field"><span class="sr-only">Email address</span><span aria-hidden="true">✉</span><input id="loginEmail" type="email" placeholder="Email address" autocomplete="username" required /></label><label class="login-field"><span class="sr-only">Password</span><span aria-hidden="true">♙</span><input id="loginPassword" type="password" placeholder="Password" autocomplete="current-password" required /><button id="toggleLoginPassword" type="button" aria-label="Show password">◉</button></label><div class="login-options"><span class="login-session-note">Your session stays active until you sign out.</span><button type="button" id="forgotLoginPassword">Forgot password?</button></div>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}${notice ? `<div class="auth-success" role="status">${escapeHtml(notice)}</div>` : ''}<button class="login-submit" type="submit">Sign In</button></form><div class="login-divider"><span>OR</span></div><button class="login-google" id="googleLogin" type="button"><span aria-hidden="true">G</span> Continue with Google</button><p class="login-new">New to PuckNexus?</p><button class="login-create" id="showSignUp" type="button">Create an Account</button><p class="login-belong">Coaches. Teams. Players. Communities.<br>All belong here.</p>`, 'signin');
  bindAuthLanding();
  authScreen.querySelector('#showSignUp').addEventListener('click', () => showSignUp());
  authScreen.querySelector('#toggleLoginPassword').addEventListener('click', () => {
    const input = authScreen.querySelector('#loginPassword');
    input.type = input.type === 'password' ? 'text' : 'password';
    authScreen.querySelector('#toggleLoginPassword').setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
  });
  authScreen.querySelector('#forgotLoginPassword').addEventListener('click', async () => {
    const email = authScreen.querySelector('#loginEmail').value.trim();
    if (!email) { showLogin('Enter your email address first, then choose Forgot password.'); return; }
    try {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
      showLogin(error ? formatAuthError(error) : '', error ? '' : 'If this email has an account, a password reset link has been sent.');
    } catch (error) { showLogin(formatAuthError(error)); }
  });
  authScreen.querySelector('#googleLogin').addEventListener('click', async () => {
    try {
      const { error } = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${location.pathname}` } });
      if (error) showLogin(formatAuthError(error));
    } catch (error) { showLogin(formatAuthError(error)); }
  });
  authScreen.querySelector('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
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

function showSignUp(error = '', noticeText = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.removeAttribute('aria-hidden');
  authScreen.innerHTML = authLanding(`<h1>Create your Puck<span>Nexus</span> account</h1><p class="login-intro">Start a new organization and team. Setup progress saves automatically.</p>${noticeText ? `<div class="auth-success" role="status">${escapeHtml(noticeText)}</div>` : ''}<form class="auth-form login-signup-form" id="signUpForm"><label>Your name<input id="signUpName" type="text" autocomplete="name" maxlength="120" required /></label><label>Email address<input id="signUpEmail" type="email" autocomplete="username" required /></label><label>Password<input id="signUpPassword" type="password" autocomplete="new-password" minlength="8" required /></label><label>Confirm password<input id="signUpPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required /></label>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}<button class="login-submit" type="submit">Create account</button></form><p class="login-new">Already have an account?</p><button class="login-create" id="showSignIn" type="button">Sign In</button>`, 'signup');
  bindAuthLanding();
  authScreen.querySelector('#showSignIn').addEventListener('click', () => showLogin());
  authScreen.querySelector('#signUpForm').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.querySelector('#signUpName').value.trim();
    const email = form.querySelector('#signUpEmail').value.trim();
    const password = form.querySelector('#signUpPassword').value;
    const confirmation = form.querySelector('#signUpPasswordConfirm').value;
    if (password !== confirmation) {
      showSignUp('The passwords do not match.');
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Creating account…';
    try {
      const { data, error: signUpError } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { data: { display_name: name } }
      });
      if (signUpError) {
        showSignUp(formatAuthError(signUpError));
        return;
      }
      if (data.session?.user) {
        await loadAuthenticatedWorkspace(data.session.user);
        return;
      }
      showSignUp('', 'Account created. Check your email to confirm it, then return here and sign in.');
    } catch (signUpError) {
      console.error('Supabase sign-up request failed:', signUpError);
      showSignUp(formatAuthError(signUpError));
    }
  });
}

function showPasswordRecovery(error = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.removeAttribute('aria-hidden');
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="platform-lockup"><img src="./assets/pucknexus-official.png" alt="PuckNexus — THE BEST PUCKING ANALYTICS" width="1280" height="1280" /></div></div><h1>Set a new password</h1><p>Choose a new password for your ${PLATFORM.name} account.</p><form class="auth-form" id="recoveryForm"><label>New password<input id="recoveryPassword" type="password" autocomplete="new-password" minlength="8" required /></label><label>Confirm new password<input id="recoveryPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required /></label>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}<button class="btn primary" type="submit">Update password</button></form></div>`;
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
  read('games', 'team_games', 'id,source_game_id,season_id,date,opponent,period_length_min', PERMISSIONS.GAMES_VIEW, undefined, true);
  read('playerStats', 'team_game_player_stats', 'source_game_id,season_id,source_player_id,player_type,gp,goals,assists,shots,penalty_minutes,plus_minus,blocks,faceoff_wins,faceoff_losses,faceoff_attempts,power_play_goals,power_play_assists,power_play_points,short_handed_goals,short_handed_assists,short_handed_points,game_winning_goals,game_tying_goals,takeaways,giveaways,chances,toi_minutes,minutes,saves,goals_against,wins,losses,ties,shutouts', PERMISSIONS.STATS_VIEW, undefined, true);
  read('teamStats', 'team_game_team_stats', 'source_game_id,season_id,goals_for,goals_against,shots_for,shots_against,shots_for_p1,shots_for_p2,shots_for_p3,shots_for_ot,shots_against_p1,shots_against_p2,shots_against_p3,shots_against_ot,power_play_chances,power_play_success,penalty_kill_chances,penalty_kill_success,faceoff_wins,faceoff_losses', PERMISSIONS.STATS_VIEW, undefined, true);
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
  window.PuckTeamBranding.apply(null);
  document.querySelector('#tenantWordmark')?.remove();
  selectedGameId = '';
  gameWorkspaceTab = 'overview';
  coachQol.openGame(null, [], []);
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
  authScreen.innerHTML = `<div class="auth-card admin-auth-card"><div class="auth-brand"><div class="platform-lockup"><img src="./assets/pucknexus-official.png" alt="PuckNexus — THE BEST PUCKING ANALYTICS" width="1280" height="1280" /></div></div><h1>Admin Dashboard</h1><p class="admin-identity">Signed in as ${escapeHtml(displayName)} · ${escapeHtml(roleLabel)}</p><div id="platformAdminRoot" class="platform-admin-root-host"></div><div class="auth-actions">${hasTeamMemberships ? '<button class="btn" id="continueToTeamWorkspace" type="button">Open team workspace</button>' : ''}<button class="btn" id="authScreenSignOut" type="button">Sign out</button></div></div>`;
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
  authScreen.innerHTML = `<div class="auth-card onboarding-auth-card"><div class="auth-brand"><div class="platform-lockup"><img src="./assets/pucknexus-official.png" alt="PuckNexus — THE BEST PUCKING ANALYTICS" width="1280" height="1280" /></div></div><div id="onboardingRoot" class="onboarding-root-host"></div></div>`;
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
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="platform-lockup"><img src="./assets/pucknexus-official.png" alt="PuckNexus — THE BEST PUCKING ANALYTICS" width="1280" height="1280" /></div></div><h1>No active team access</h1><p>${escapeHtml(message || 'This account has no platform role and no active organization or team membership. An invitation from your organization or team owner is required before a workspace can be opened.')}</p><div class="auth-actions"><button class="btn" id="authScreenSignOut" type="button">Sign out</button></div></div>`;
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
    // A confirmed self-service account has no memberships yet. Create its
    // server-backed onboarding row before resolving a destination; otherwise a
    // legitimate new coach would be indistinguishable from a no-access user.
    // Existing team members and Platform Admin accounts never enter this path.
    if (!platformAccess.isPlatformAdmin
        && membershipContext
        && membershipContext.memberships.length === 0
        && membershipContext.pendingMemberships.length === 0) {
      const { error: onboardingEnsureError } = await supabaseClient.rpc('onboarding_ensure');
      if (onboardingEnsureError) throw new Error(onboardingEnsureError.message || 'Onboarding could not be started.');
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
  if (!window.PuckTeamBranding.canLeave()) return;
  if (coachQol.saveState === coachQol.SAVE_STATES.SAVING) return;
  if (!confirmTeamStatsDiscard()) return;
  if (coachQol.dirty && !window.confirm('You have unsaved stats. Leave without saving?')) return;
  coachQol.openGame(null, [], []);
  selectedGameId = '';
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
