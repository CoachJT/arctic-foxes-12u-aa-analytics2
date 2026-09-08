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
const workspaceAccessManager = window.FoxesWorkspaceAccess.createWorkspaceAccess({ client: supabaseClient });
const organizationContextManager = window.FoxesOrganizationContext.createOrganizationContext();
const entitlements = window.FoxesEntitlements.createEntitlements();
const rosterManager = window.FoxesRosterManagement.createRosterManagement({
  client: supabaseClient,
  getWorkspace: () => currentWorkspace
});
const statsEntryManager = window.FoxesStatsEntry.createStatsEntry({
  client: supabaseClient,
  getWorkspace: () => currentWorkspace
});
const mediaStorage = window.FoxesMediaStorage.createMediaStorage({
  client: supabaseClient,
  getWorkspace: () => currentWorkspace
});
const supportReporting = window.FoxesSupportReporting.createSupportReporting({
  client: supabaseClient,
  getWorkspace: () => currentWorkspace,
  getUser: () => authUser
});
window.addEventListener('error', event => window.FoxesSupportReporting.recordError(event.error || event.message, { route: location.pathname }));
window.addEventListener('unhandledrejection', event => window.FoxesSupportReporting.recordError(event.reason, { route: location.pathname }));
const INVITE_FUNCTION = 'invite-staff';
const WORKSPACE_INVITE_ACCEPT_FUNCTION = 'accept-workspace-invite';
const BETA_ONBOARDING_REISSUE_FUNCTION = 'reissue-beta-onboarding-invite';
let activeStaff = null;
let authUser = null;
let authTeam = null;
let authCapabilities = [];
let platformAdminAuthorized = false;
let betaOnboardingSummary = null;
let inviteAcceptanceAttempted = false;
let currentWorkspace = null;
let recoveryMode = false;
let workspaceTransitioning = false;
let rosterFilter = 'active';
let rosterSearch = '';
let rosterImportPreview = null;
let phase1Data = null;
let phase1DataError = '';
let phase2AData = null;
let phase2ADataError = '';
let statsSortKey = 'pts';
let statsSortDir = 'desc';
let statsEntryGameId = null;
let statsEntryStep = 'skaters';
let statsEntryDraft = null;
let statsEntrySaving = false;
let statsEntryError = '';
let statsEntrySavedMessage = '';
const teamContextManager = window.FoxesTeamContext.createTeamContext({ client: supabaseClient });
const seasonContextManager = window.FoxesSeasonContext.createSeasonContext({ client: supabaseClient });
document.addEventListener('error', event => {
  if (event.target instanceof HTMLImageElement) event.target.hidden = true;
}, true);
const teamContext = teamContextManager.context;
const seasonContext = seasonContextManager.context;
applyDocumentBrand();
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const queryParams = new URLSearchParams(location.search);
const workspaceInviteToken = hashParams.get('invite_token');
const authCallbackPresent = ['access_token', 'refresh_token', 'type', 'code', 'error', 'error_code']
  .some(key => hashParams.has(key) || queryParams.has(key));
const recoveryCallbackPresent = hashParams.get('type') === 'recovery'
  || queryParams.get('type') === 'recovery';
const prototypeMode = !authCallbackPresent
  && location.hostname === 'localhost'
  && queryParams.get('prototype') === '1';

const viewNames = { command: 'Home', team: 'Team Overview', schedule: 'Schedule', games: 'Game Center', players: 'Players', stats: 'Team Stats', film: 'Film Room', scouting: 'Scouting', reports: 'Coach Reports', development: 'Player Development', coaching: 'Coaching Tools', management: 'Team Management', support: 'Support', settings: 'Settings', 'platform-admin': 'Platform Admin' };
const roleViews = { command: PERMISSIONS.DASHBOARD_VIEW, team: PERMISSIONS.PLAYERS_VIEW, schedule: PERMISSIONS.SCHEDULE_VIEW, games: PERMISSIONS.GAMES_VIEW, players: PERMISSIONS.PLAYERS_VIEW, stats: PERMISSIONS.STATS_VIEW, film: PERMISSIONS.GAMES_VIEW, scouting: PERMISSIONS.SCOUTING_VIEW, reports: PERMISSIONS.REPORTS_VIEW, development: PERMISSIONS.PLAYERS_VIEW, coaching: PERMISSIONS.REPORTS_VIEW, management: PERMISSIONS.ADMIN_USERS, support: PERMISSIONS.DASHBOARD_VIEW, settings: PERMISSIONS.DASHBOARD_VIEW };
const viewFeatures = { command: 'dashboard', team: 'players', schedule: 'schedule', games: 'games', players: 'players', stats: 'stats', film: 'games', scouting: 'scouting', reports: 'reports', development: 'players', coaching: 'reports', management: 'admin', support: 'dashboard', settings: 'dashboard' };

function cardTitle(title, link = '') { return `<div class="card-title"><h2>${title}</h2>${link ? `<a href="#">${link} →</a>` : ''}</div>`; }
function tenantName() { return currentWorkspace?.branding?.display_name || currentWorkspace?.team_name || seasonContext.branding?.display_name || authTeam?.teams?.name || 'Selected team'; }
function tenantSeasonName() { return currentWorkspace?.season_name || seasonContext.selectedSeason?.name || phase1Data?.seasonRecord?.season_key || 'Live season'; }
function shell(title, subtitle, body) { return `<div class="page-head"><div><div class="eyebrow">${PLATFORM.name} · ${escapeHtml(tenantName())} workspace</div><h1>${title}</h1><p>${subtitle}</p></div></div>${body}`; }

function notice(text) { return `<div class="callout prototype-note">${text}</div>`; }
function phase1Number(value) { return Number.isFinite(Number(value)) ? Number(value) : 0; }
function phase1Date(value) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' }) : 'Date unavailable'; }
function phase1Record() { return phase1Data?.seasonRecord || { games_played: 0, wins: 0, losses: 0, ties: 0, goals_for: 0, goals_against: 0 }; }
function phase1DateKey(value = new Date()) { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; }
function phase1TimeValue(value) {
  if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours > 23 || minutes > 59 ? null : (hours * 60) + minutes;
}
function phase1ScheduleSort(a, b) {
  return String(a?.date || '').localeCompare(String(b?.date || ''))
    || String(a?.time || '99:99').localeCompare(String(b?.time || '99:99'));
}
function phase1NextScheduledGame(now = new Date()) {
  const today = phase1DateKey(now);
  const minutesNow = (now.getHours() * 60) + now.getMinutes();
  return (phase1Data?.schedule || [])
    .filter(game => {
      const date = String(game?.date || '');
      if (!date) return false;
      if (date > today) return true;
      if (date < today) return false;
      const timeValue = phase1TimeValue(game?.time);
      return timeValue == null || timeValue >= minutesNow;
    })
    .slice()
    .sort(phase1ScheduleSort)[0] || null;
}
function phase1LatestCompletedGame(now = new Date()) {
  const today = phase1DateKey(now);
  const teamStats = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  return (phase1Data?.games || [])
    .map(game => ({ game, stats: teamStats.get(game.source_game_id) || null }))
    .filter(({ game, stats }) => stats && String(game?.date || '') && String(game.date) <= today)
    .slice()
    .sort((a, b) => String(b.game?.date || '').localeCompare(String(a.game?.date || '')))[0] || null;
}
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
function rosterDisplayName(player) {
  return player?.name || [player?.first_name, player?.last_name].filter(Boolean).join(' ') || 'Roster player';
}
function isGoalie(player) {
  return player?.position === 'G' || player?.player_type === 'goalie' || player?.is_goalie === true || (player?.pos || '').includes('G');
}
function activeRosterPlayers(roster = []) {
  return roster.filter(player => {
    const status = typeof player?.status === 'string' ? player.status.trim().toLowerCase() : '';
    if (!status) return true;
    return status === 'active';
  });
}
function leaders() {
  const stats = playerStatTotals();
  return (phase1Data?.roster || []).map(player => ({ player, totals: stats.get(player.source_player_id) || {} }))
    .sort((a, b) => (phase1Number(b.totals.goals) + phase1Number(b.totals.assists)) - (phase1Number(a.totals.goals) + phase1Number(a.totals.assists)))
    .slice(0, 4)
    .map(({ player, totals }) => {
      const goals = phase1Number(totals.goals);
      const assists = phase1Number(totals.assists);
      return `<div class="leader"><span class="jersey">#${escapeHtml(player.jersey_number || '–')}</span><div class="leader-info"><strong>${escapeHtml(rosterDisplayName(player))}</strong><small>${escapeHtml(player.position || '—')} · ${phase1Number(totals.games)} GP</small></div><div class="leader-stats"><span>${goals} G</span><span>${assists} A</span></div><span class="leader-value">${goals + assists} P</span></div>`;
    }).join('');
}
function recent(now = new Date()) {
  const today = phase1DateKey(now);
  const statByGame = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  return (phase1Data?.games || [])
    .filter(game => statByGame.has(game.source_game_id) && String(game?.date || '') && String(game.date) <= today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 4)
    .map(game => {
      const stat = statByGame.get(game.source_game_id) || {};
      const gf = phase1Number(stat.goals_for);
      const ga = phase1Number(stat.goals_against);
      const result = gf > ga ? 'W' : gf < ga ? 'L' : 'T';
      return `<div class="game-row"><div><strong>${escapeHtml(game.opponent)}</strong><small>${phase1Date(game.date)}</small></div><span class="score">${gf}–${ga}</span><span class="result ${result === 'W' ? 'win' : result === 'L' ? 'loss' : ''}">${result === 'W' ? 'WIN' : result === 'L' ? 'LOSS' : 'TIE'}</span><span class="arrow">›</span></div>`;
    }).join('');
}

function command() {
  const record = phase1Record();
  const nextGame = phase1NextScheduledGame();
  const latestCompleted = phase1LatestCompletedGame();
  const totalGames = record.games_played;
  const roster = activeRosterPlayers(phase1Data?.roster || []);
  const playersCount = roster.length;
  const goaliesCount = roster.filter(isGoalie).length;

  const orgName = tenantName();
  const teamNameStr = authTeam?.team_name || authTeam?.name || currentWorkspace?.team_name || 'Selected Team';
  const seasonStr = tenantSeasonName();
  const fallbackLogoUrl = currentWorkspace?.branding?.logo_url || currentWorkspace?.branding?.logo || '';
  const brandingSource = { ...(currentWorkspace?.branding || {}), ...(seasonContext.branding || {}), settings: seasonContext.branding?.settings || {} };
  const brandingAssets = globalThis.FoxesBrandingAssets?.normalize?.(brandingSource) || {
    logoUrl: fallbackLogoUrl, heroImageUrl: null, welcomeImageUrl: null, secondaryImageUrl: null, wordmarkUrl: null, watermarkUrl: null, tagline: null, motto: null, featureImages: {}
  };
  const visualBackgroundStyle = url => url ? ` style="--organization-image:url('${escapeHtml(url)}')"` : '';
  const orgMark = orgName.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'PN';
  const welcomeName = activeStaff?.name || activeStaff?.role || 'Coach';
  const opponentMark = String(nextGame?.opponent || 'OP').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'OP';

  // Development/performance snapshot: only metrics backed by the canonical
  // season record and completed games with synced team stats. Nothing is
  // projected or inferred beyond the synced numbers.
  const todayKey = phase1DateKey(new Date());
  const teamStatsByGame = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  const recentForm = (phase1Data?.games || [])
    .filter(game => teamStatsByGame.has(game.source_game_id) && String(game?.date || '') && String(game.date) <= todayKey)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 5)
    .map(game => {
      const stats = teamStatsByGame.get(game.source_game_id) || {};
      const goalsFor = phase1Number(stats.goals_for);
      const goalsAgainst = phase1Number(stats.goals_against);
      return goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'T';
    });
  const winPercentage = totalGames ? Math.round((phase1Number(record.wins) / totalGames) * 100) : null;

  const nextGameCard = nextGame ? `
      <div class="game-top">
        <div class="opponent">
          ${brandingAssets.logoUrl ? `<img class="team-game-crest" src="${escapeHtml(brandingAssets.logoUrl)}" alt="${escapeHtml(orgName)} crest">` : `<span class="opponent-mark">${escapeHtml(orgMark)}</span>`}
          <div>
            <span class="eyebrow">Next Game</span>
            <h2>vs ${escapeHtml(nextGame.opponent || 'Opponent')}</h2>
            <p>${escapeHtml(teamNameStr)} &middot; ${escapeHtml(seasonStr)}</p>
          </div>
        </div>
        ${nextGame.home_away ? `<span class="home-pill">${escapeHtml(nextGame.home_away)}</span>` : ''}
      </div>
      <div class="game-date">
        <strong>${escapeHtml(phase1Date(nextGame.date))}</strong>
        <span>${nextGame.time ? escapeHtml(nextGame.time) : 'Time to be announced'}</span>
      </div>
      ${nextGame.notes ? `<div class="game-preview"><span class="eyebrow">Game Preview</span><p>${escapeHtml(nextGame.notes)}</p></div>` : ''}
      <div class="game-meta">
        <span>Location<b>${escapeHtml(nextGame.location || 'To be announced')}</b></span>
        <span>Home / Away<b>${escapeHtml(nextGame.home_away || 'To be announced')}</b></span>
        <span>Game type<b>${escapeHtml(nextGame.game_type || 'Scheduled game')}</b></span>
      </div>`
    : `<div class="next-game-empty"><div class="empty-icon">◷</div><h2>No upcoming games scheduled.</h2><p class="empty-text">The next scheduled game will appear here as soon as it is synced for the selected team and season.</p></div>`;

  return shell(
    'Dashboard',
    'Command Center for team performance, scheduling, and analytics.',
    `<section class="org-identity-banner"${visualBackgroundStyle(brandingAssets.heroImageUrl)}>
      ${brandingAssets.watermarkUrl || brandingAssets.logoUrl ? `<img class="identity-watermark" src="${escapeHtml(brandingAssets.watermarkUrl || brandingAssets.logoUrl)}" alt="" aria-hidden="true">` : ''}
      <div class="identity-brand">
        ${brandingAssets.wordmarkUrl ? `<img class="identity-wordmark" src="${escapeHtml(brandingAssets.wordmarkUrl)}" alt="${escapeHtml(orgName)}">` : brandingAssets.logoUrl ? `<img class="identity-logo" src="${escapeHtml(brandingAssets.logoUrl)}" alt="${escapeHtml(orgName)} logo">` : `<span class="identity-mark" aria-hidden="true">${escapeHtml(orgMark)}</span>`}
        <div><span class="eyebrow">PuckNexus organization workspace</span><strong>${escapeHtml(orgName)}</strong><small>${escapeHtml(teamNameStr)} · ${escapeHtml(seasonStr)}</small></div>
      </div>
      <div class="identity-message"><span>${escapeHtml(brandingAssets.tagline || 'TEAM OPERATIONS')}</span><strong>${escapeHtml(brandingAssets.motto || 'DEVELOP COMPETE BELONG').replace(/\s+/g, '<br>')}</strong></div>
    </section>
    <div class="command-layout"><main class="command-main"><section class="hero card command-hero"${visualBackgroundStyle(brandingAssets.welcomeImageUrl || brandingAssets.secondaryImageUrl)}>
      ${brandingAssets.watermarkUrl || brandingAssets.logoUrl ? `<img class="hero-watermark" src="${escapeHtml(brandingAssets.watermarkUrl || brandingAssets.logoUrl)}" alt="" aria-hidden="true">` : ''}
      <div class="welcome-content">
        <span class="eyebrow">Welcome back,</span>
        <h1 class="welcome-title">${escapeHtml(welcomeName)}.</h1>
        <p class="welcome-meta">${escapeHtml(activeStaff?.role || 'Team member')} <b>·</b> ${escapeHtml(teamNameStr)} <b>·</b> ${escapeHtml(seasonStr)}</p>
        ${(brandingAssets.tagline || brandingAssets.motto) ? `<p class="welcome-message">${escapeHtml(brandingAssets.tagline || brandingAssets.motto)}</p>` : ''}
        <div class="welcome-actions"><button class="btn primary" type="button" onclick="render('film')">View Latest Game Film</button><button class="btn secondary" type="button" onclick="render('team')">Team Dashboard</button></div>
      </div>
    </section>

    <section class="metrics-grid">
      <article class="metric-card">
        <span class="metric-label">Games Played</span>
        <strong class="metric-value">${totalGames}</strong>
        <span class="metric-meta">${record.wins}-${record.losses}-${record.ties} Record</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Goals For</span>
        <strong class="metric-value">${record.goals_for}</strong>
        <span class="metric-meta">Season Total</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Goals Against</span>
        <strong class="metric-value">${record.goals_against}</strong>
        <span class="metric-meta">Season Total</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Active Roster</span>
        <strong class="metric-value">${playersCount} Players</strong>
        <span class="metric-meta">${playersCount && goaliesCount > 0 ? `${goaliesCount} Goalie${goaliesCount === 1 ? '' : 's'}` : playersCount ? 'Active players' : 'No players synced'}</span>
      </article>
    </section>

    <div class="dashboard-grid">
      <section class="card next-game dashboard-feature">
        ${nextGameCard}
        <div class="card-actions">
          <button class="btn secondary" type="button" onclick="render('schedule')">View Full Schedule &rarr;</button>
        </div>
      </section>

      <section class="card">
        <h3>Latest Result</h3>
        ${latestCompleted ? `
          <div class="latest-result">
            <strong>${escapeHtml(latestCompleted.game.opponent || 'Game')} (${phase1Number(latestCompleted.stats.goals_for) > phase1Number(latestCompleted.stats.goals_against) ? 'W' : phase1Number(latestCompleted.stats.goals_for) < phase1Number(latestCompleted.stats.goals_against) ? 'L' : 'T'} ${phase1Number(latestCompleted.stats.goals_for)}–${phase1Number(latestCompleted.stats.goals_against)})</strong>
            <small>${escapeHtml(phase1Date(latestCompleted.game.date))}</small>
          </div>
        ` : `<p class="empty-text">No recent game results logged.</p>`}
        <div class="card-actions">
          <button class="btn secondary" type="button" onclick="render('games')">Open Game Center &rarr;</button>
        </div>
      </section>

      <section class="card">
        <h3>Recent Games</h3>
        <div class="recent">
          ${recent() || '<p class="empty-text">No completed games are synced yet.</p>'}
        </div>
        <div class="card-actions">
          <button class="btn secondary" type="button" onclick="render('games')">All Games &rarr;</button>
        </div>
      </section>

      <section class="card">
        <h3>Top Players</h3>
        <div class="leaders-list">
          ${leaders() || '<p class="empty-text">No roster performers are synced yet.</p>'}
        </div>
        <div class="card-actions">
          <button class="btn secondary" type="button" onclick="render('stats')">View Stats &rarr;</button>
        </div>
      </section>

      <section class="card perf-card">
        <h3>Team Performance</h3>
        ${totalGames ? `
          <div class="perf-grid">
            <div class="perf-metric">
              <span class="metric-label">Win Rate</span>
              <strong class="metric-value">${winPercentage}%</strong>
              <span class="metric-meta">${record.wins}-${record.losses}-${record.ties} over ${totalGames} GP</span>
            </div>
            <div class="perf-metric">
              <span class="metric-label">Goals For / Against</span>
              <strong class="metric-value perf-score">${record.goals_for} / ${record.goals_against}</strong>
              <span class="metric-meta">${(phase1Number(record.goals_for) / totalGames).toFixed(1)} GF &middot; ${(phase1Number(record.goals_against) / totalGames).toFixed(1)} GA per game</span>
            </div>
            <div class="perf-metric">
              <span class="metric-label">Recent Record</span>
              <strong class="metric-value perf-form">${recentForm.length ? recentForm.map(result => `<span class="form-badge ${result === 'W' ? 'win' : result === 'L' ? 'loss' : 'tie'}">${result}</span>`).join('') : '—'}</strong>
              <span class="metric-meta">${recentForm.length ? `Last ${recentForm.length} completed game${recentForm.length === 1 ? '' : 's'}` : 'No completed games synced'}</span>
            </div>
          </div>
        ` : `<p class="empty-text">Team performance metrics appear once completed games with synced stats are available.</p>`}
      </section>

      <section class="card">
        <h3>Quick Access</h3>
        <div class="quick-access feature-access">
          ${[['film', 'Film Room', 'Watch. Learn. Improve.', 'icon-film'], ['scouting', 'Scouting', 'Know your opponent.', 'icon-scouting'], ['reports', 'Reports', 'Insights that matter.', 'icon-reports'], ['development', 'Player Development', 'Track progress.', 'icon-development'], ['coaching', 'Coaching Tools', 'Practice plans. Resources.', 'icon-tools']].map(([view, label, description, icon]) => `<button class="btn secondary feature-tile"${visualBackgroundStyle(brandingAssets.featureImages[view === 'coaching' ? 'coaching_tools' : view])} type="button" onclick="render('${view}')"><svg class="nav-icon"><use href="#${icon}"></use></svg><span><strong>${label}</strong><small>${description}</small></span><b>›</b></button>`).join('')}
        </div>
      </section>
    </div></main>
    <aside class="org-rail">
      <section class="rail-panel rail-glance"><h3>${escapeHtml(orgName)} at a glance</h3><dl><div><dt>Team</dt><dd>${escapeHtml(teamNameStr)}</dd></div><div><dt>Season</dt><dd>${escapeHtml(seasonStr)}</dd></div><div><dt>Roster</dt><dd>${playersCount} Active Players</dd></div><div><dt>Goalies</dt><dd>${goaliesCount}</dd></div></dl></section>
      <section class="rail-panel rail-message">${brandingAssets.secondaryImageUrl ? `<img src="${escapeHtml(brandingAssets.secondaryImageUrl)}" alt="" aria-hidden="true">` : brandingAssets.logoUrl ? `<img src="${escapeHtml(brandingAssets.logoUrl)}" alt="" aria-hidden="true">` : `<span>${escapeHtml(orgMark)}</span>`}<strong>${escapeHtml(brandingAssets.motto || 'BUILDING A STRONGER TEAM, TOGETHER.')}</strong></section>
      <section class="rail-panel rail-next"><h3>Upcoming team events</h3>${nextGame ? `<p><strong>${escapeHtml(phase1Date(nextGame.date))}</strong><span>vs ${escapeHtml(nextGame.opponent || 'Opponent')}</span><small>${escapeHtml(nextGame.time || 'Time to be announced')}</small></p>` : '<p class="empty-text">No upcoming team events are scheduled.</p>'}<button class="btn secondary" type="button" onclick="render('schedule')">View Full Schedule →</button></section>
    </aside></div>`
  );
}

function team() {
  const record = phase1Record();
  const roster = phase1Data?.roster || [];
  const orgName = tenantName();
  const teamNameStr = authTeam?.team_name || authTeam?.name || 'Authorized Team';
  const seasonStr = tenantSeasonName();
  const logoUrl = currentWorkspace?.branding?.logo_url || currentWorkspace?.branding?.logo || '';

  return shell(
    'Team Overview',
    'Team identity, season standings, staff access, and roster summary.',
    `<section class="hero card" style="display:flex; align-items:center; gap:20px; flex-wrap:wrap;">
      ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(orgName)}" style="max-height:64px; width:auto; border-radius:8px;">` : ''}
      <div>
        <h1 style="margin:0;">${escapeHtml(teamNameStr)}</h1>
        <p class="subtitle" style="margin:4px 0 0 0;">${escapeHtml(orgName)} &middot; ${escapeHtml(seasonStr)}</p>
      </div>
    </section>

    <section class="metrics-grid" style="margin-top:20px;">
      <article class="metric-card">
        <span class="metric-label">Organization</span>
        <strong class="metric-value" style="font-size:18px;">${escapeHtml(orgName)}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">Season</span>
        <strong class="metric-value" style="font-size:18px;">${escapeHtml(seasonStr)}</strong>
      </article>
      <article class="metric-card">
        <span class="metric-label">Record</span>
        <strong class="metric-value">${record.wins}-${record.losses}-${record.ties}</strong>
        <span class="metric-meta">${record.games_played} GP</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Active Roster</span>
        <strong class="metric-value">${roster.length}</strong>
        <span class="metric-meta">${roster.length ? 'Players Enrolled' : 'No players synced'}</span>
      </article>
    </section>

    <div class="dashboard-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 24px;">
      <section class="card">
        <h3>Staff & Role Summary</h3>
        <div style="margin-top:12px; font-size:14px; color:var(--text);">
          <p><strong>Your Access Role:</strong> <span class="badge" style="background:var(--brand-primary); color:white;">${escapeHtml(activeStaff?.role || 'Member')}</span></p>
          <p><strong>Workspace Plan:</strong> ${escapeHtml(currentWorkspace?.plan_id || 'Standard')}</p>
        </div>
      </section>

      <section class="card">
        <h3>Quick Actions</h3>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
          <button class="btn secondary" type="button" onclick="render('players')">Manage & View Roster</button>
          <button class="btn secondary" type="button" onclick="render('schedule')">Schedule & Events</button>
          <button class="btn secondary" type="button" onclick="render('stats')">Season Leaderboards</button>
        </div>
      </section>
    </div>`
  );
}

function film() {
  return shell(
    'Film Room',
    'Video analysis, tag clips, and game film review module surface.',
    `<section class="card empty-view">
      <div class="empty-icon">🎥</div>
      <h2>Film Room Module Surface</h2>
      <p>Video breakdown tools and clip tagging will connect to live video sources in upcoming PuckNexus Beta releases.</p>
      <span class="badge" style="margin-top:12px; background:var(--surface); color:var(--text-muted); border:1px solid var(--border);">Beta Surface &middot; Read Only</span>
    </section>`
  );
}

function coaching() {
  return shell(
    'Coaching Tools',
    'Practice plans, line combination tools, and tactical playbook module surface.',
    `<section class="card empty-view">
      <div class="empty-icon">📋</div>
      <h2>Coaching Tools Surface</h2>
      <p>Line builder, playbook designer, and practice plan generator module surface.</p>
      <span class="badge" style="margin-top:12px; background:var(--surface); color:var(--text-muted); border:1px solid var(--border);">Beta Surface &middot; Read Only</span>
    </section>`
  );
}

function management() {
  return teamManagement();
}

function platformAdmin() {
  const planOptions = ['CORE', 'COACH', 'ELITE', 'FOUNDING', 'ORGANIZATION']
    .map(plan => `<option value="${plan}">${plan}${plan === 'FOUNDING' ? ' · Founding recognition' : ''}</option>`)
    .join('');
  const summary = betaOnboardingSummary
    ? `<section class="callout onboarding-summary" aria-live="polite"><strong>Workspace ready</strong><br>${escapeHtml(betaOnboardingSummary.organizationName)} · ${escapeHtml(betaOnboardingSummary.teamName)} · ${escapeHtml(betaOnboardingSummary.seasonName)}<br>Plan: ${escapeHtml(betaOnboardingSummary.planId)} · ${escapeHtml(betaOnboardingSummary.recognitionLabel)}<br>First coach invitation: <strong>${escapeHtml(betaOnboardingSummary.inviteStatus)}</strong> for ${escapeHtml(betaOnboardingSummary.coachEmail)}.${betaOnboardingSummary.inviteStatus === 'pending' ? `<br><a href="${escapeHtml(betaOnboardingSummary.inviteUrl)}">One-time acceptance link</a> — copy it to the first coach only through an approved channel. Expires in 72 hours; no email was sent.<div class="actions onboarding-actions"><button class="btn" id="reissueBetaOnboardingInvite" type="button">Reissue link</button><button class="btn" id="revokeBetaOnboardingInvite" type="button">Revoke invitation</button></div>` : ''}</section>`
    : '';
  return shell(
    'Platform Admin',
    'Controlled Beta workspace provisioning is separate from team coaching and management.',
    `<section class="card onboarding-card">
      <div class="card-title"><div><span class="eyebrow">Controlled Beta</span><h2>Create a new workspace</h2></div><span class="tag">Platform Admin only</span></div>
      <p class="settings-copy">Creates an organization, team, active season, entitlement, basic branding, and a pending first-coach invitation in one secure operation. No email is sent from this screen.</p>
      ${summary}<form id="betaOnboardingForm" class="player-form onboarding-form">
        <label>Organization name<input id="onboardingOrganizationName" maxlength="120" required placeholder="Organization name" /></label>
        <label>Organization slug<input id="onboardingOrganizationSlug" maxlength="120" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="organization-name" /></label>
        <label>Team name<input id="onboardingTeamName" maxlength="120" required placeholder="Team name" /></label>
        <label>Team slug<input id="onboardingTeamSlug" maxlength="120" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="team-name" /></label>
        <label>Season name<input id="onboardingSeasonName" maxlength="120" required placeholder="2026–2027 Season" /></label>
        <label>Season key<input id="onboardingSeasonKey" maxlength="80" required placeholder="2026-2027" /></label>
        <label>Season starts<input id="onboardingSeasonStartsOn" type="date" required /></label>
        <label>Season ends<input id="onboardingSeasonEndsOn" type="date" required /></label>
        <label>Beta plan<select id="onboardingPlanId" required>${planOptions}</select></label>
        <label>Brand display name<input id="onboardingBrandDisplayName" maxlength="120" required placeholder="Team display name" /></label>
        <label>Brand short name<input id="onboardingBrandShortName" maxlength="32" required placeholder="Team initials" /></label>
        <label>Stable logo URL<input id="onboardingBrandLogoUrl" type="url" maxlength="2048" required placeholder="https://example.org/logo.png" /></label>
        <label>Primary color<input id="onboardingBrandPrimaryColor" maxlength="7" required pattern="#[0-9A-Fa-f]{6}" value="#173B58" /></label>
        <label>Secondary color<input id="onboardingBrandSecondaryColor" maxlength="7" required pattern="#[0-9A-Fa-f]{6}" value="#FFFFFF" /></label>
        <label>Accent color<input id="onboardingBrandAccentColor" maxlength="7" required pattern="#[0-9A-Fa-f]{6}" value="#61D4F5" /></label>
        <label>First coach name<input id="onboardingCoachName" maxlength="120" autocomplete="name" required /></label>
        <label>First coach email<input id="onboardingCoachEmail" type="email" maxlength="320" autocomplete="email" required /></label>
        <label>First coach role<select id="onboardingCoachRoleId" required><option value="owner">Owner</option><option value="head_coach">Head Coach</option><option value="assistant">Assistant Coach</option><option value="team_manager">Team Manager</option><option value="video_coach">Video Coach</option></select></label>
        <div class="player-form-actions"><button class="btn primary" type="submit">Create Beta workspace</button></div>
        <div id="betaOnboardingStatus" class="invite-status player-form-wide" role="status">No workspace has been created.</div>
      </form>
    </section>`
  );
}

function schedule() { return shell('Schedule','Live schedule synced from the team Windows app.',`<section class="card">${cardTitle(`Team schedule · ${phase1Data?.schedule?.length || 0} entries`,'Supabase read-only')}<div class="schedule-list">${(phase1Data?.schedule || []).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(game=>`<div class="schedule-item"><div class="schedule-date"><strong>${escapeHtml(new Date(`${game.date}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'2-digit'}).toUpperCase())}</strong>${escapeHtml(String(game.date).slice(0,4))}</div><div><h3>${escapeHtml(game.opponent)}</h3><p>${escapeHtml(game.home_away)} · ${escapeHtml(game.location || 'Location unavailable')}${game.time ? ` · ${escapeHtml(game.time)}` : ''}</p></div><span class="tag">${escapeHtml(game.game_type)}</span></div>`).join('') || '<div class="empty-view"><h2>No schedule entries</h2><p>No synced schedule entries are available for this team.</p></div>'}</div></section>`); }
function statsNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function statsValue(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function statsAccumulate(total, value) { const number = statsValue(value); return number === null ? total : (total === null ? number : total + number); }
function statsPercent(value, total) { const denominator = statsNumber(total); return denominator > 0 ? statsNumber(value) / denominator * 100 : null; }
function statsFormat(value, digits = 1) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : Number.isInteger(Number(value)) ? String(value) : Number(value).toFixed(digits).replace(/0+$/, '').replace(/\.$/, ''); }
function statsCompare(left, right) {
  if (left === null || left === undefined) return right === null || right === undefined ? 0 : 1;
  if (right === null || right === undefined) return -1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
}
function statsDescendingCompare(left, right) { return statsCompare(right, left); }
function statsRankedRows(rows, key) {
  return rows.slice().sort((left, right) => statsDescendingCompare(left[key], right[key])
    || statsDescendingCompare(left.pts, right.pts)
    || statsDescendingCompare(left.g, right.g)
    || String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
    || String(left.jersey_number || '').localeCompare(String(right.jersey_number || ''), undefined, { numeric: true, sensitivity: 'base' }));
}
function statsRows() {
  const roster = new Map((phase1Data?.roster || []).map(player => [String(player.source_player_id), { ...player, gp: 0, g: null, a: null, sog: null, pim: null, pm: null, blocks: null, fow: null, fol: null, ppg: null, ppp: null, shg: null, shp: null }]));
  (phase1Data?.playerStats || []).forEach(source => {
    const key = String(source.source_player_id || '');
    if (!key) return;
    const row = roster.get(key) || { source_player_id: source.source_player_id, name: source.player_name || 'Player', jersey_number: source.jersey_number || '#', position: source.position || 'F', player_type: source.player_type || 'skater', gp: 0, g: null, a: null, sog: null, pim: null, pm: null, blocks: null, fow: null, fol: null, ppg: null, ppp: null, shg: null, shp: null };
    row.gp += statsNumber(source.gp);
    row.g = statsAccumulate(row.g, source.goals);
    row.a = statsAccumulate(row.a, source.assists);
    row.sog = statsAccumulate(row.sog, source.shots);
    row.pim = statsAccumulate(row.pim, source.penalty_minutes);
    row.pm = statsAccumulate(row.pm, source.plus_minus);
    row.blocks = statsAccumulate(row.blocks, source.blocks);
    row.fow = statsAccumulate(row.fow, source.faceoff_wins);
    row.fol = statsAccumulate(row.fol, source.faceoff_losses);
    row.ppg = statsAccumulate(row.ppg, source.power_play_goals);
    row.ppp = statsAccumulate(row.ppp, source.power_play_points);
    row.shg = statsAccumulate(row.shg, source.short_handed_goals);
    row.shp = statsAccumulate(row.shp, source.short_handed_points);
    roster.set(key, row);
  });
  return [...roster.values()]
    .filter(row => !isGoalie(row))
    .map(row => {
      const faceoffAttempts = row.fow !== null && row.fol !== null ? row.fow + row.fol : null;
      const pts = row.g !== null && row.a !== null ? row.g + row.a : null;
      return {
        ...row,
        pts,
        shootingPct: row.g !== null && row.sog !== null ? statsPercent(row.g, row.sog) : null,
        faceoffPct: faceoffAttempts !== null ? statsPercent(row.fow, faceoffAttempts) : null,
        faceoffAttempts
      };
    });
}
function goalieRows() {
  const roster = new Map((phase1Data?.roster || []).map(player => [String(player.source_player_id), player]));
  const totals = new Map();
  (phase1Data?.playerStats || []).forEach(source => {
    const key = String(source.source_player_id || '');
    if (!key) return;
    const player = roster.get(key) || {};
    if (!isGoalie({ ...player, position: player.position || source.position, player_type: player.player_type || source.player_type, is_goalie: player.is_goalie || source.is_goalie })) return;
    const row = totals.get(key) || { source_player_id: source.source_player_id, name: source.player_name || player.name || 'Goalie', jersey_number: player.jersey_number || source.jersey_number || '#', gp: 0, wins: 0, losses: 0, ties: 0, saves: null, goalsAgainst: null, shotsAgainst: null, minutes: null };
    row.gp += statsNumber(source.gp);
    row.wins += statsNumber(source.wins);
    row.losses += statsNumber(source.losses);
    row.ties += statsNumber(source.ties);
    row.saves = statsAccumulate(row.saves, source.saves);
    row.goalsAgainst = statsAccumulate(row.goalsAgainst, source.goals_against);
    row.shotsAgainst = statsAccumulate(row.shotsAgainst, source.shots_against);
    row.minutes = statsAccumulate(row.minutes, statsValue(source.minutes) ?? statsValue(source.toi_minutes));
    totals.set(key, row);
  });
  return [...totals.values()].map(row => {
    const shotsAgainst = row.shotsAgainst !== null ? row.shotsAgainst : (row.saves !== null && row.goalsAgainst !== null ? row.saves + row.goalsAgainst : null);
    const savePct = row.saves !== null && shotsAgainst !== null && shotsAgainst > 0 ? row.saves / shotsAgainst : null;
    const gaa = row.goalsAgainst !== null && row.minutes !== null && row.minutes > 0 ? row.goalsAgainst / (row.minutes / 60) : null;
    return { ...row, shotsAgainst, savePct, gaa };
  }).sort((left, right) => statsDescendingCompare(left.savePct, right.savePct)
    || statsDescendingCompare(left.saves, right.saves)
    || String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }));
}
function stats() {
  const record = phase1Record(); const teamStats = phase1Data?.teamStats || []; const skaters = statsRows(); const goalies = goalieRows(); const activePlayers = activeRosterPlayers(phase1Data?.roster || []); const gp = statsNumber(record.games_played); const gf = statsNumber(record.goals_for); const ga = statsNumber(record.goals_against); const branding = seasonContext.branding || {}; const teamName = tenantName(); const mark = String(branding.short_name || branding.display_name || teamName || 'PN').replace(/\s+/g, '').slice(0, 2).toUpperCase(); const logoUrl = currentWorkspace?.branding?.logo_url || currentWorkspace?.branding?.logo || ''; const brandingAssets = globalThis.FoxesBrandingAssets?.normalize?.({ ...(currentWorkspace?.branding || {}), ...branding, settings: branding.settings || {} }) || { logoUrl, heroImageUrl: null, wordmarkUrl: null, watermarkUrl: null };
  const formatLeaderValue = (row, key, suffix) => `${statsFormat(key.endsWith('Pct') ? row[key] : row[key], key.endsWith('Pct') ? 1 : 0)}${suffix}`;
  const renderSkaterHead = row => `<div class="leader-head"><span class="leader-jersey">#${escapeHtml(row.jersey_number || '#')}</span><div><strong>${escapeHtml(row.name || 'Player')}</strong><small>${escapeHtml(row.position || 'F')} · ${row.gp} GP</small></div></div>`;
  const leader = (label, key, suffix, secondary) => {
    const rows = statsRankedRows(skaters.filter(item => item[key] !== null), key);
    if (!rows.length) return `<article class="leader-card empty"><span class="leader-type">${label}</span><div class="leader-empty">Unavailable — not tracked</div></article>`;
    const leaders = rows.filter(row => row[key] === rows[0][key]);
    return `<article class="leader-card${leaders.length > 1 ? ' tied' : ''}"><span class="leader-type">${label}</span>${leaders.map(renderSkaterHead).join('')}<div class="leader-stat"><strong>${formatLeaderValue(rows[0], key, suffix)}</strong><span>${leaders.length > 1 ? `Tied leader${leaders.length > 2 ? ` · ${leaders.length} players` : ''}` : secondary(rows[0])}</span></div></article>`;
  };
  const leaderCards = [leader('POINTS LEADER', 'pts', ' PTS', row => `${statsFormat(row.g, 0)} G • ${statsFormat(row.a, 0)} A`), leader('GOALS LEADER', 'g', ' G', row => `${statsFormat(row.sog, 0)} SOG`), leader('ASSISTS LEADER', 'a', ' A', row => `${statsFormat(row.pts, 0)} PTS`), leader('SHOTS LEADER', 'sog', ' S', row => `${statsFormat(row.shootingPct)}% SHOOTING`), leader('FACEOFF LEADER', 'faceoffPct', '%', row => `${statsFormat(row.fow, 0)} FOW`)];
  const goalieLeaders = statsRankedRows(goalies.filter(row => row.savePct !== null), 'savePct');
  const goalieLeaderValue = goalieLeaders[0];
  leaderCards.push(goalieLeaderValue
    ? `<article class="leader-card${goalieLeaders.filter(row => row.savePct === goalieLeaderValue.savePct).length > 1 ? ' tied' : ''}"><span class="leader-type">GOALIE SAVE % LEADER</span>${goalieLeaders.filter(row => row.savePct === goalieLeaderValue.savePct).map(row => `<div class="leader-head"><span class="leader-jersey">#${escapeHtml(row.jersey_number)}</span><div><strong>${escapeHtml(row.name)}</strong><small>G · ${row.gp} GP</small></div></div>`).join('')}<div class="leader-stat"><strong>${statsFormat(goalieLeaderValue.savePct * 100)}%</strong><span>${goalieLeaders.filter(row => row.savePct === goalieLeaderValue.savePct).length > 1 ? 'Tied leader' : `${statsFormat(goalieLeaderValue.saves, 0)} SV • ${statsFormat(goalieLeaderValue.goalsAgainst, 0)} GA`}</span></div></article>`
    : '<article class="leader-card empty"><span class="leader-type">GOALIE SAVE % LEADER</span><div class="leader-empty">Unavailable — not tracked</div></article>');
  const categories = [['Points', 'pts'], ['Goals', 'g'], ['Assists', 'a'], ['Shots', 'sog'], ['Shooting %', 'shootingPct'], ['PIM', 'pim'], ['Plus/Minus', 'pm'], ['Blocks', 'blocks'], ['Faceoff %', 'faceoffPct'], ['Power Play Points', 'ppp'], ['Short-Handed Points', 'shp']];
  const topFive = categories.map(([label, key]) => {
    const rows = statsRankedRows(skaters.filter(row => row[key] !== null), key).slice(0, 5);
    let previousValue = null;
    let displayedRank = 0;
    return `<section class="card leaderboard-panel"><div class="card-title"><h2>${label}</h2><span class="tag">${rows.length ? 'Top 5' : 'Unavailable'}</span></div><ol class="leaderboard-list">${rows.length ? rows.map((row, index) => {
      if (index === 0 || row[key] !== previousValue) displayedRank = index + 1;
      previousValue = row[key];
      return `<li class="leaderboard-item"><span class="leaderboard-rank rank-${Math.min(displayedRank, 3)}">${displayedRank}</span><span class="leaderboard-number">#${escapeHtml(row.jersey_number || '#')}</span><div class="leaderboard-meta"><strong>${escapeHtml(row.name || 'Player')}</strong><small>${escapeHtml(row.position || 'F')} · ${row.gp} GP</small></div><span class="leaderboard-stat">${key.endsWith('Pct') ? `${statsFormat(row[key])}%` : statsFormat(row[key], 0)}</span></li>`;
    }).join('') : '<li class="leaderboard-empty">Unavailable — not tracked</li>'}</ol></section>`;
  }).join('');
  const columns = [['#', 'jersey_number'], ['Player', 'name'], ['Pos', 'position'], ['GP', 'gp'], ['G', 'g'], ['A', 'a'], ['PTS', 'pts'], ['SOG', 'sog'], ['S%', 'shootingPct'], ['PIM', 'pim'], ['+/-', 'pm'], ['Blocks', 'blocks'], ['FO', 'faceoffAttempts'], ['FOW', 'fow'], ['FO%', 'faceoffPct'], ['PPG', 'ppg'], ['PPP', 'ppp'], ['SHG', 'shg'], ['SHP', 'shp']];
  const sorted = skaters.slice().sort((left, right) => {
    const result = statsCompare(left[statsSortKey], right[statsSortKey])
      || String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
      || String(left.jersey_number || '').localeCompare(String(right.jersey_number || ''), undefined, { numeric: true, sensitivity: 'base' });
    return statsSortDir === 'asc' ? result : -result;
  });
  const skaterTable = sorted.map(row => `<tr><td class="team-number">#${escapeHtml(row.jersey_number || '#')}</td><td><div class="player-cell"><span class="player-photo">${escapeHtml(String(row.jersey_number || '#').slice(0, 2))}</span><strong>${escapeHtml(row.name || 'Player')}</strong></div></td><td>${escapeHtml(row.position || 'F')}</td><td>${row.gp}</td><td>${statsFormat(row.g, 0)}</td><td>${statsFormat(row.a, 0)}</td><td>${statsFormat(row.pts, 0)}</td><td>${statsFormat(row.sog, 0)}</td><td>${statsFormat(row.shootingPct)}${row.shootingPct === null ? '' : '%'}</td><td>${statsFormat(row.pim, 0)}</td><td>${statsFormat(row.pm, 0)}</td><td>${statsFormat(row.blocks, 0)}</td><td>${statsFormat(row.faceoffAttempts, 0)}</td><td>${statsFormat(row.fow, 0)}</td><td>${statsFormat(row.faceoffPct)}${row.faceoffPct === null ? '' : '%'}</td><td>${statsFormat(row.ppg, 0)}</td><td>${statsFormat(row.ppp, 0)}</td><td>${statsFormat(row.shg, 0)}</td><td>${statsFormat(row.shp, 0)}</td></tr>`).join('') || '<tr><td colspan="19" class="empty-state">No skater statistics are available.</td></tr>';
  const goalieTable = goalies.map(row => `<tr><td class="team-number">#${escapeHtml(row.jersey_number)}</td><td><div class="player-cell"><span class="player-photo">G</span><strong>${escapeHtml(row.name)}</strong></div></td><td>${row.gp}</td><td>${row.wins}</td><td>${row.losses}</td><td>${row.ties}</td><td>${statsFormat(row.shotsAgainst, 0)}</td><td>${statsFormat(row.saves, 0)}</td><td>${statsFormat(row.goalsAgainst, 0)}</td><td>${row.savePct === null ? '—' : `${statsFormat(row.savePct * 100)}%`}</td><td>${row.gaa === null ? '—' : statsFormat(row.gaa)}</td></tr>`).join('') || '<tr><td colspan="11" class="empty-state">No legitimate goalie data exists.</td></tr>';
  const teamStatsByGame = new Map(teamStats.map(row => [row.source_game_id, row]));
  const today = phase1DateKey(new Date());
  const trendRows = (phase1Data?.games || [])
    .map((game, index) => ({ game, stats: teamStatsByGame.get(game.source_game_id) || null, index }))
    .filter(({ game, stats }) => stats && String(game?.date || '') && String(game.date) <= today && statsValue(stats.goals_for) !== null && statsValue(stats.goals_against) !== null)
    .sort((left, right) => String(left.game.date || '').localeCompare(String(right.game.date || '')) || left.index - right.index);
  const trend = trendRows.map(({ game, stats }) => `<div class="trend-bar"><span style="height:${Math.max(12, statsNumber(stats.goals_for) * 18)}%"></span><small>${escapeHtml(String(game.date || '').slice(5) || 'Game')}</small></div>`).join('');
  const trendAgainst = trendRows.map(({ game, stats }) => `<div class="trend-bar"><span class="trend-against" style="height:${Math.max(12, statsNumber(stats.goals_against) * 18)}%"></span><small>${escapeHtml(String(game.date || '').slice(5) || 'Game')}</small></div>`).join('');
  return shell('TEAM ANALYTICS', 'Season Performance Dashboard', `<div class="stats-dashboard"><section class="stats-brand-banner"${brandingAssets.heroImageUrl ? ` style="--organization-image:url('${escapeHtml(brandingAssets.heroImageUrl)}')"` : ''}><div class="brand-cluster"><div class="org-mark">${brandingAssets.logoUrl ? `<img src="${escapeHtml(brandingAssets.logoUrl)}" alt="${escapeHtml(branding.display_name || teamName)} crest" class="stats-logo-img">` : escapeHtml(mark || 'PN')}</div><div><span class="eyebrow">Organization analytics</span>${brandingAssets.wordmarkUrl ? `<img class="stats-wordmark" src="${escapeHtml(brandingAssets.wordmarkUrl)}" alt="${escapeHtml(branding.display_name || teamName)}">` : `<strong>${escapeHtml(branding.display_name || teamName)}</strong>`}<small>${escapeHtml(teamName)} · ${escapeHtml(tenantSeasonName())}</small></div></div><div class="stats-brand-copy">TEAM<br>ANALYTICS</div></section><section class="stats-hero card">${brandingAssets.watermarkUrl || brandingAssets.logoUrl ? `<img class="stats-watermark" src="${escapeHtml(brandingAssets.watermarkUrl || brandingAssets.logoUrl)}" alt="" aria-hidden="true">` : ''}<div class="stats-hero-top"><div class="brand-cluster"><div><div class="eyebrow">Season performance</div><strong>${escapeHtml(teamName)}</strong></div></div><div class="stats-record-wrap"><span>Season record</span><strong>${record.wins}–${record.losses}–${record.ties}</strong></div></div><div class="stats-hero-meta"><div><div class="subtle-label">Team</div><strong>${escapeHtml(teamName)}</strong></div><div><div class="subtle-label">Season</div><strong>${escapeHtml(tenantSeasonName())}</strong></div><div><div class="subtle-label">Games</div><strong>${gp}</strong></div></div></section><section class="stats-metrics-grid">${[['Games Played', gp], ['Record', `${record.wins}–${record.losses}–${record.ties}`], ['Goals For', gf], ['Goals Against', ga], ['Goal Differential', gf - ga], ['Goals Per Game', statsFormat(gp ? gf / gp : null)], ['Goals Against Per Game', statsFormat(gp ? ga / gp : null)], ['Active Players', activePlayers.length]].map(([label, value]) => `<article class="card stats-metric"><div class="stat-legend">${label}</div><strong>${value}</strong><span>Synced season data</span></article>`).join('')}</section><section class="stats-section-header"><h2>Season Leaders</h2></section><section class="leader-card-grid">${leaderCards.join('')}</section><section class="stats-section-header"><h2>Top 5 Leaderboards</h2></section><section class="top5-grid">${topFive}</section><section class="stats-section-header"><h2>Skater Stat Table</h2></section><section class="card skater-table-shell"><div class="table-wrap"><table class="data-table compact-table"><thead><tr>${columns.map(([label, key]) => `<th><button class="table-sort" type="button" data-sort-key="${key}">${label}${statsSortKey === key ? (statsSortDir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}</tr></thead><tbody>${skaterTable}</tbody></table></div></section><section class="stats-section-header"><h2>Goalie Analytics</h2></section><section class="card goalie-shell"><div class="table-wrap"><table class="data-table compact-table"><thead><tr><th>#</th><th>Player</th><th>GP</th><th>W</th><th>L</th><th>T</th><th>SA</th><th>Saves</th><th>GA</th><th>Save %</th><th>GAA</th></tr></thead><tbody>${goalieTable}</tbody></table></div></section><section class="stats-section-header"><h2>Team Trends</h2></section><section class="card trend-shell"><div class="trend-pair"><div class="trend-chart">${trend || '<div class="trend-empty">No completed team trend data</div>'}</div><div class="trend-chart">${trendAgainst || '<div class="trend-empty">No completed team trend data</div>'}</div></div><div class="trend-label">Goals For / Goals Against by completed game</div></section></div>`);
}
function rosterCanManage() {
  return Boolean(currentWorkspace?.authorized)
    && can(PERMISSIONS.PLAYERS_EVALUATE, activeStaff)
    && entitlements.isFeatureEnabled('players');
}

function playerForm(player = {}) {
  return `<form id="playerForm" class="player-form">
    <input type="hidden" id="playerId" value="${escapeHtml(player.id || '')}">
    <label>Jersey number<input id="playerJersey" required maxlength="3" inputmode="numeric" value="${escapeHtml(player.jersey_number || '')}"></label>
    <label>First name<input id="playerFirstName" required maxlength="80" value="${escapeHtml(player.first_name || '')}"></label>
    <label>Last name<input id="playerLastName" required maxlength="80" value="${escapeHtml(player.last_name || '')}"></label>
    <label>Position<select id="playerPosition" required><option value="F" ${player.position === 'F' ? 'selected' : ''}>F</option><option value="D" ${player.position === 'D' ? 'selected' : ''}>D</option><option value="G" ${player.position === 'G' ? 'selected' : ''}>G</option></select></label>
    <label>Player type<select id="playerType" required><option value="skater" ${player.player_type !== 'goalie' ? 'selected' : ''}>Skater</option><option value="goalie" ${player.player_type === 'goalie' ? 'selected' : ''}>Goalie</option></select></label>
    <label>Shoots<select id="playerShoots"><option value="unknown" ${!['L', 'R'].includes(player.shoots) ? 'selected' : ''}>Unknown</option><option value="L" ${player.shoots === 'L' ? 'selected' : ''}>L</option><option value="R" ${player.shoots === 'R' ? 'selected' : ''}>R</option></select></label>
    <label>Status<select id="playerStatus"><option value="active" ${player.status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${player.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label>
    <label class="player-form-wide">Notes<textarea id="playerNotes" maxlength="2000">${escapeHtml(player.notes || '')}</textarea></label>
    <div class="player-form-actions"><button class="btn" type="button" id="cancelPlayerForm">Cancel</button><button class="btn primary" type="submit">${player.id ? 'Save changes' : 'Add player'}</button></div>
    <div id="playerFormStatus" class="invite-status" role="status"></div>
  </form>`;
}

function players() {
  const totals = playerStatTotals();
  const manage = rosterCanManage();
  const allPlayers = phase1Data?.roster || [];
  const filtered = allPlayers.filter(player => {
    const statusMatches = rosterFilter === 'all' || (player.status || 'active') === rosterFilter;
    const query = rosterSearch.toLowerCase();
    return statusMatches && (!query || `${player.name} ${player.jersey_number} ${player.position}`.toLowerCase().includes(query));
  });
  const rows = filtered.map(player => {
    const stat = totals.get(player.source_player_id) || {};
    const hasHistory = phase1Number(stat.games) > 0 || phase1Number(stat.goals) > 0 || phase1Number(stat.assists) > 0 || phase1Number(stat.minutes) > 0;
    return `<tr class="${player.status === 'inactive' ? 'roster-inactive' : ''}">
      <td><div class="player-cell"><span class="player-photo">${escapeHtml(player.jersey_number)}</span><strong>${escapeHtml(player.name)}</strong></div></td>
      <td class="role">${escapeHtml(player.position)}</td><td>${escapeHtml(player.shoots || '—')}</td>
      <td>${hasHistory ? phase1Number(stat.games) : '—'}</td><td>${hasHistory ? phase1Number(stat.goals) : '—'}</td>
      <td>${hasHistory ? phase1Number(stat.goals) + phase1Number(stat.assists) : '—'}</td>
      <td><span class="tag">${player.status === 'inactive' ? 'Inactive' : 'Active'}</span>${manage ? `<div class="roster-row-actions"><button class="btn roster-edit" type="button" data-player-id="${escapeHtml(player.id)}">Edit</button><button class="btn roster-toggle" type="button" data-player-id="${escapeHtml(player.id)}" data-status="${player.status === 'inactive' ? 'active' : 'inactive'}">${player.status === 'inactive' ? 'Reactivate' : 'Deactivate'}</button></div>` : ''}</td>
    </tr>`;
  }).join('');
  const empty = !allPlayers.length
    ? `<div class="empty-view roster-empty"><div class="empty-icon">♙</div><h2>No players yet</h2><p>Add players one at a time or import your roster to start tracking games and analytics.</p>${manage ? '<div class="roster-empty-actions"><button class="btn primary" id="addPlayerButton" type="button">+ Add Player</button><button class="btn" id="importRosterButton" type="button">Import Roster</button><button class="btn" id="downloadRosterTemplate" type="button">Download Template</button></div>' : ''}</div>`
    : `<div class="table-wrap"><table class="data-table roster-table"><thead><tr><th>Player</th><th>Pos</th><th>Shoots</th><th>Games</th><th>Goals</th><th>Points</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No players match the selected filter.</td></tr>'}</tbody></table></div>`;
  return shell('Roster', 'Manage the selected team roster without changing historical data.', `<section class="card roster-card">
    <div class="roster-toolbar"><div><div class="eyebrow">${allPlayers.length} player${allPlayers.length === 1 ? '' : 's'}</div><h2>Team roster</h2></div><div class="roster-actions">${manage ? '<button class="btn primary" id="addPlayerButton" type="button">+ Add Player</button><button class="btn" id="importRosterButton" type="button">Import Roster</button><button class="btn" id="downloadRosterTemplate" type="button">Download Template</button>' : ''}</div></div>
    <div class="roster-filters"><input id="rosterSearch" type="search" placeholder="Search players" value="${escapeHtml(rosterSearch)}"><select id="rosterFilter" aria-label="Roster status filter"><option value="active" ${rosterFilter === 'active' ? 'selected' : ''}>Active</option><option value="all" ${rosterFilter === 'all' ? 'selected' : ''}>All</option><option value="inactive" ${rosterFilter === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
    ${empty}
  </section><div id="playerDialog" class="modal-shell" hidden><div class="modal-card"><div class="card-title"><h2 id="playerDialogTitle">Add Player</h2><button class="btn" type="button" id="closePlayerDialog">Close</button></div>${playerForm()}</div></div><div id="importDialog" class="modal-shell" hidden><div class="modal-card"><div class="card-title"><h2>Import Roster</h2><button class="btn" type="button" id="closeImportDialog">Close</button></div><p class="settings-copy">Upload a CSV using the roster template. Invalid rows are rejected and likely duplicates require confirmation.</p><input id="rosterFile" type="file" accept=".csv,text/csv"><div id="importPreview" class="import-preview"></div><div class="player-form-actions"><button class="btn primary" id="confirmRosterImport" type="button" disabled>Confirm import</button></div></div></div>`);
}
function canEnterGameStats() {
  return Boolean(currentWorkspace?.authorized)
    && can(PERMISSIONS.STATS_EDIT, activeStaff)
    && entitlements.isFeatureEnabled('stats');
}

// Games are only ever selectable for stat entry when they belong to the
// authorized team (phase1Data is already team-scoped by loadPhase1Data), so
// no cross-team game id can ever appear in this list — the server-side RPC
// re-validates team/season ownership regardless. team_games rows are, by
// design, only synced from the Windows app after a game has been played, but
// as a client-side safety net (mirrored by the save_game_stats RPC's
// game.date <= current_date guard) a game dated in the future is excluded
// from the enterable list rather than trusted at face value.
function statsEntryGames() {
  const today = phase1DateKey();
  return (phase1Data?.games || [])
    .filter(game => String(game.date || '') <= today)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function statsEntryRosterFor(playerType) {
  const roster = phase1Data?.roster || [];
  const existing = existingStatRowsForGame(statsEntryGameId);
  const historicalIds = new Set(existing.filter(row => (row.player_type || 'skater') === playerType).map(row => String(row.source_player_id)));
  return roster.filter(player => {
    const matchesType = playerType === 'goalie' ? isGoalie(player) : !isGoalie(player);
    if (!matchesType) return false;
    const status = typeof player?.status === 'string' ? player.status.trim().toLowerCase() : '';
    // Active roster by default, but never drop a player who already has saved
    // stats for this game — editing historical data must keep working even if
    // the player has since gone inactive.
    return status !== 'inactive' || historicalIds.has(String(player.source_player_id));
  });
}

function existingStatRowsForGame(sourceGameId) {
  return (phase1Data?.playerStats || []).filter(row => row.source_game_id === sourceGameId);
}

function existingTeamStatsForGame(sourceGameId) {
  return (phase1Data?.teamStats || []).find(row => row.source_game_id === sourceGameId) || null;
}

function statsEntryRowValues(existingRow, fields) {
  const values = {};
  fields.forEach(field => { values[field] = existingRow && existingRow[field] !== undefined ? existingRow[field] : null; });
  return values;
}

function ensureStatsEntryDraft(game) {
  if (statsEntryDraft && statsEntryDraft.source_game_id === game.source_game_id) return statsEntryDraft;
  const existing = existingStatRowsForGame(game.source_game_id);
  const existingSkaters = window.FoxesStatsEntry.existingSkaterStatsByPlayer(existing);
  const existingGoalies = window.FoxesStatsEntry.existingGoalieStatsByPlayer(existing);
  const skaters = new Map(statsEntryRosterFor('skater').map(player => {
    const key = String(player.source_player_id);
    return [key, statsEntryRowValues(existingSkaters.get(key), window.FoxesStatsEntry.SKATER_FIELDS)];
  }));
  const goalies = new Map(statsEntryRosterFor('goalie').map(player => {
    const key = String(player.source_player_id);
    return [key, statsEntryRowValues(existingGoalies.get(key), window.FoxesStatsEntry.GOALIE_FIELDS)];
  }));
  const team = statsEntryRowValues(existingTeamStatsForGame(game.source_game_id), window.FoxesStatsEntry.TEAM_FIELDS);
  statsEntryDraft = { source_game_id: game.source_game_id, skaters, goalies, team };
  return statsEntryDraft;
}

function openStatsEntry(sourceGameId) {
  const game = statsEntryGames().find(item => item.source_game_id === sourceGameId);
  if (!game || !canEnterGameStats()) return;
  statsEntryGameId = sourceGameId;
  statsEntryStep = 'skaters';
  statsEntryError = '';
  statsEntrySavedMessage = '';
  statsEntryDraft = null;
  ensureStatsEntryDraft(game);
  render('games');
}

function closeStatsEntry() {
  statsEntryGameId = null;
  statsEntryStep = 'skaters';
  statsEntryDraft = null;
  statsEntryError = '';
  statsEntrySaving = false;
}

const STATS_ENTRY_STEPS = [
  ['skaters', 'Skater Stats'],
  ['goalies', 'Goalie Stats'],
  ['team', 'Team Stats'],
  ['review', 'Review & Save']
];
const SKATER_ENTRY_COLUMNS = [['GP', 'gp'], ['G', 'goals'], ['A', 'assists'], ['SOG', 'shots'], ['PIM', 'penalty_minutes'], ['+/-', 'plus_minus'], ['Blocks', 'blocks'], ['FOW', 'faceoff_wins'], ['FOL', 'faceoff_losses'], ['PPG', 'power_play_goals'], ['PPP', 'power_play_points'], ['SHG', 'short_handed_goals'], ['SHP', 'short_handed_points']];
const GOALIE_ENTRY_COLUMNS = [['GP', 'gp'], ['W', 'wins'], ['L', 'losses'], ['T', 'ties'], ['Saves', 'saves'], ['GA', 'goals_against'], ['Min', 'minutes'], ['SO', 'shutouts']];
const TEAM_ENTRY_COLUMNS = [['Goals For', 'goals_for'], ['Goals Against', 'goals_against'], ['Shots For', 'shots_for'], ['Shots Against', 'shots_against']];

function statsEntryCellValue(value) { return value === null || value === undefined ? '' : String(value); }

function statsEntryStepNav() {
  return `<div class="stat-entry-steps">${STATS_ENTRY_STEPS.map(([key, label], index) => `<button type="button" class="stat-entry-step${statsEntryStep === key ? ' active' : ''}" data-stats-step="${key}">${index + 1}. ${label}</button>`).join('')}</div>`;
}

function statsEntryPlayerTable(playerType, columns) {
  const roster = statsEntryRosterFor(playerType);
  const draft = playerType === 'goalie' ? statsEntryDraft.goalies : statsEntryDraft.skaters;
  const rows = roster.map(player => {
    const key = String(player.source_player_id);
    const values = draft.get(key) || {};
    const cells = columns.map(([, field]) => `<td><input type="text" inputmode="decimal" class="stat-cell-input" data-stats-player="${escapeHtml(key)}" data-stats-type="${playerType}" data-stats-field="${field}" value="${escapeHtml(statsEntryCellValue(values[field]))}"></td>`).join('');
    return `<tr><td class="team-number">#${escapeHtml(player.jersey_number || '#')}</td><td>${escapeHtml(player.name || 'Player')}</td>${cells}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table compact-table stat-entry-table"><thead><tr><th>#</th><th>Player</th>${columns.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${columns.length + 2}" class="empty-state">No ${playerType === 'goalie' ? 'goalies' : 'skaters'} are available on the active roster for this game.</td></tr>`}</tbody></table></div>`;
}

function statsEntryTeamForm() {
  const values = statsEntryDraft.team || {};
  const fields = TEAM_ENTRY_COLUMNS.map(([label, field]) => `<label>${label}<input type="text" inputmode="decimal" class="stat-cell-input" data-stats-team-field="${field}" value="${escapeHtml(statsEntryCellValue(values[field]))}"></label>`).join('');
  return `<form class="player-form" id="statsEntryTeamForm">${fields}</form>`;
}

function statsEntryReview(game) {
  const skaterRows = [...statsEntryDraft.skaters.entries()].filter(([, row]) => Object.values(row).some(value => value !== null));
  const goalieRows = [...statsEntryDraft.goalies.entries()].filter(([, row]) => Object.values(row).some(value => value !== null));
  const teamTouched = Object.values(statsEntryDraft.team || {}).some(value => value !== null);
  const rosterByKey = new Map((phase1Data?.roster || []).map(player => [String(player.source_player_id), player]));
  const skaterSummary = skaterRows.map(([key, row]) => {
    const player = rosterByKey.get(key);
    const pts = window.FoxesStatsEntry.derivePoints(row);
    return `<li><strong>${escapeHtml(player?.name || key)}</strong> — GP ${statsEntryCellValue(row.gp) || '—'}, G ${statsEntryCellValue(row.goals) || '—'}, A ${statsEntryCellValue(row.assists) || '—'}, PTS ${pts === null ? '—' : pts}</li>`;
  }).join('');
  const goalieSummary = goalieRows.map(([key, row]) => {
    const player = rosterByKey.get(key);
    const { shotsAgainst, savePct } = window.FoxesStatsEntry.deriveGoalieMetrics(row);
    return `<li><strong>${escapeHtml(player?.name || key)}</strong> — GP ${statsEntryCellValue(row.gp) || '—'}, Saves ${statsEntryCellValue(row.saves) || '—'}, SA ${shotsAgainst === null ? '—' : shotsAgainst}, SV% ${savePct === null ? '—' : `${(savePct * 100).toFixed(1)}%`}</li>`;
  }).join('');
  return `<section class="card">${cardTitle(`Review · ${escapeHtml(game.opponent || 'Opponent unavailable')}`)}<p class="settings-copy">Saving writes skater, goalie, and team stats together. If any row fails validation, nothing is saved.</p>
    <h3>Skaters (${skaterRows.length})</h3><ul class="stat-review-list">${skaterSummary || '<li>No skater stats entered.</li>'}</ul>
    <h3>Goalies (${goalieRows.length})</h3><ul class="stat-review-list">${goalieSummary || '<li>No goalie stats entered.</li>'}</ul>
    <h3>Team stats</h3><p>${teamTouched ? TEAM_ENTRY_COLUMNS.map(([label, field]) => `${label}: ${statsEntryCellValue(statsEntryDraft.team[field]) || '—'}`).join(' · ') : 'No team stats entered.'}</p>
    ${statsEntryError ? `<div class="auth-error" role="alert">${escapeHtml(statsEntryError)}</div>` : ''}
    ${statsEntrySavedMessage ? `<div class="callout">${escapeHtml(statsEntrySavedMessage)}</div>` : ''}
    <div class="player-form-actions"><button class="btn" type="button" id="cancelStatsEntry">Cancel</button><button class="btn primary" type="button" id="saveStatsEntry" ${statsEntrySaving ? 'disabled' : ''}>${statsEntrySaving ? 'Saving…' : 'Save Stats'}</button></div>
  </section>`;
}

function statsEntrySection(game) {
  ensureStatsEntryDraft(game);
  const stepBody = statsEntryStep === 'skaters' ? statsEntryPlayerTable('skater', SKATER_ENTRY_COLUMNS)
    : statsEntryStep === 'goalies' ? statsEntryPlayerTable('goalie', GOALIE_ENTRY_COLUMNS)
    : statsEntryStep === 'team' ? statsEntryTeamForm()
    : statsEntryReview(game);
  return `<div class="callout"><strong>Enter Stats · ${escapeHtml(game.opponent || 'Opponent unavailable')}</strong><br>${escapeHtml(phase1Date(game.date))} · Blank cells stay untracked (not zero). Use Tab to move between cells.</div>
    ${statsEntryStepNav()}
    <section class="card stat-entry-shell">${stepBody}</section>
    ${statsEntryStep !== 'review' ? `<div class="player-form-actions"><button class="btn" type="button" id="cancelStatsEntry">Cancel</button><button class="btn primary" type="button" id="nextStatsStep">Next</button></div>` : ''}`;
}

function gameCenter() {
  const teamStats = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  const playerStats = new Map();
  (phase1Data?.playerStats || []).forEach(row => playerStats.set(row.source_game_id, (playerStats.get(row.source_game_id) || 0) + 1));
  const games = statsEntryGames();
  if (statsEntryGameId) {
    const activeGame = games.find(item => item.source_game_id === statsEntryGameId);
    if (activeGame) return shell('Game Center', 'Enter or edit official game stats for the selected team and season.', statsEntrySection(activeGame));
    closeStatsEntry();
  }
  const canEnter = canEnterGameStats();
  const scheduled = (phase1Data?.schedule || []).filter(item => !games.some(game => game.source_game_id === item.linked_game_source_id));
  const scheduledCards = scheduled.slice().sort(phase1ScheduleSort).map(item => `<article class="card game-card"><div class="game-card-head"><div><span class="eyebrow">${escapeHtml(phase1Date(item.date))}</span><h2>${escapeHtml(item.opponent || 'Opponent unavailable')}</h2><p>${escapeHtml(item.home_away || '')} · ${escapeHtml(item.location || 'Location unavailable')}</p></div><span class="tag">Scheduled</span></div></article>`).join('');
  const cards = games.map(game => {
    const stats = teamStats.get(game.source_game_id);
    const hasScore = stats && (stats.goals_for !== null || stats.goals_against !== null);
    const score = hasScore ? `${phase1Number(stats.goals_for)}–${phase1Number(stats.goals_against)}` : 'Score unavailable';
    const result = hasScore ? (stats.goals_for > stats.goals_against ? 'WIN' : stats.goals_for < stats.goals_against ? 'LOSS' : 'TIE') : 'NOT SCORED';
    const hasStats = (playerStats.get(game.source_game_id) || 0) > 0 || Boolean(stats);
    return `<article class="card game-card"><div class="game-card-head"><div><span class="eyebrow">${escapeHtml(phase1Date(game.date))}</span><h2>${escapeHtml(game.opponent || 'Opponent unavailable')}</h2><p>${escapeHtml(game.period_length_min ? `${game.period_length_min}-minute periods` : 'Game details synced from Windows')}</p></div><span class="result ${result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : ''}">${result}</span></div><div class="game-score">${escapeHtml(score)}</div><div class="game-card-meta"><span>${playerStats.get(game.source_game_id) || 0} player-stat rows</span><span>${stats ? `${phase1Number(stats.shots_for)} shots for` : 'Official team stats unavailable'}</span><span class="tag">Completed</span></div>${canEnter ? `<div class="player-form-actions"><button class="btn primary" type="button" data-enter-stats="${escapeHtml(game.source_game_id)}">${hasStats ? 'Edit Stats' : 'Enter Stats'}</button></div>` : ''}</article>`;
  }).join('');
  return shell('Game Center', canEnter ? 'Select a completed game to enter or edit official stats.' : 'Read-only game summaries from the selected team and season.', `<div class="callout"><strong>${games.length} game${games.length === 1 ? '' : 's'} synced</strong><br>Only completed games from the authorized team and season are available for stat entry. Detailed video, TOI, tracking, and local game workflows remain in the Windows app.</div><div class="game-center-grid">${cards || '<section class="card empty-view"><div class="empty-icon">▣</div><h2>No games available</h2><p>No completed games are synced for the selected team and season.</p></section>'}${scheduledCards}</div>`);
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
  return shell('Settings', 'Review the selected workspace context and access model.', `<div class="settings-grid"><section class="card settings-card"><div class="card-title"><h2>Workspace context</h2><span class="tag">Read only</span></div><dl class="settings-list"><div><dt>Platform</dt><dd>${escapeHtml(PLATFORM.name)}</dd></div><div><dt>Team</dt><dd>${escapeHtml(tenantName())}</dd></div><div><dt>Season</dt><dd>${escapeHtml(tenantSeasonName())}</dd></div><div><dt>Role</dt><dd>${escapeHtml(activeStaff?.role || 'Authenticated team member')}</dd></div></dl></section><section class="card settings-card"><div class="card-title"><h2>Storage</h2><span class="tag">Private media</span></div><p class="settings-copy">Game film, reports, branding, player media, and support attachments use private workspace-scoped storage. Usage and quota values will appear when configured for this plan.</p><span class="permission-lock">No commercial quota is assumed in the browser.</span></section><section class="card settings-card"><div class="card-title"><h2>Data policy</h2><span class="tag">Supabase reads</span></div><p class="settings-copy">This browser workspace reads authorized team data through Supabase RLS. Local video, TOI, tracking, vault, backups, and device settings remain in the Windows app.</p><span class="permission-lock">${authCapabilities.length} database-provided capabilities loaded</span></section></div>`);
}
function generic(view) { const titles = { games:['Game Center','One place for game-day details and post-game review.'], reports:['Coach Reports','Turn team observations into clear, shareable reports.'], development:['Player Development','Review future cloud-backed development records.'], settings:['Settings','Configure the team hub experience and future integrations.'] }; const [title, sub] = titles[view]; return shell(title, sub, `<section class="card empty-view"><div class="empty-icon">${view === 'settings' ? '⚙' : '✦'}</div><h2>Workspace unavailable</h2><p>This surface does not have approved cloud-backed data for the selected team and season.</p></section>`); }
function support() {
  return shell('Support', 'Report a bug, request a feature, or ask a question.', `<section class="card support-card"><div class="support-hero"><div><span class="eyebrow">PuckNexus support</span><h2>Need a hand?</h2><p>Your report is saved securely to the current account and workspace.</p></div><button class="btn primary" id="openSupportForm" type="button">Report Issue</button></div><div class="support-grid"><div><strong>Bug</strong><span>Something is not working.</span></div><div><strong>Feature request</strong><span>Suggest a better workflow.</span></div><div><strong>Question</strong><span>Ask about the workspace.</span></div></div></section><div id="supportDialog" class="modal-shell" hidden><div class="modal-card"><div class="card-title"><h2>Report an issue</h2><button class="btn" type="button" id="closeSupportForm">Close</button></div><form id="supportForm" class="player-form"><label>Type<select id="supportType"><option value="bug">Bug</option><option value="feature_request">Feature request</option><option value="question">Question</option></select></label><label>Subject<input id="supportSubject" maxlength="200" required></label><label class="player-form-wide">Description<textarea id="supportDescription" maxlength="10000" required></textarea></label><label class="support-checkbox player-form-wide"><input id="supportDiagnostics" type="checkbox"> Include sanitized diagnostic information</label><div class="player-form-actions"><button class="btn primary" type="submit">Send Report</button></div><div id="supportStatus" class="invite-status" role="status"></div></form></div></div>`);
}

function bindSupportControls() {
  document.querySelector('#openSupportForm')?.addEventListener('click', () => { document.querySelector('#supportDialog').hidden = false; });
  document.querySelector('#closeSupportForm')?.addEventListener('click', () => { document.querySelector('#supportDialog').hidden = true; });
  document.querySelector('#supportForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.querySelector('#supportStatus');
    try {
      const report = await supportReporting.submit({
        reportType: form.querySelector('#supportType').value,
        subject: form.querySelector('#supportSubject').value,
        description: form.querySelector('#supportDescription').value,
        includeDiagnostics: form.querySelector('#supportDiagnostics').checked
      });
      status.textContent = `Report sent · Reference #${String(report.id).slice(0, 8)}`;
      status.className = 'invite-status success';
      form.reset();
    } catch (error) {
      supportReporting && window.FoxesSupportReporting.recordError?.(error, { operation: 'support_reports.insert' });
      status.textContent = error.message || 'Report could not be saved. Please retry.';
      status.className = 'invite-status error';
    }
  });
}

function teamManagement() {
  const owner = can(PERMISSIONS.ADMIN_USERS, activeStaff);
  return shell('Team Management', 'Set up the people and access model for the selected team.', `${owner
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
  list.innerHTML = invites.map(invite => `<div class="invite-row"><div><strong>${escapeHtml(invite.display_name || 'Pending staff member')}</strong><small>${escapeHtml(invite.email || 'Email hidden')}</small></div><span>${escapeHtml(inviteRoleLabel(invite.role_id))}</span><b class="invite-badge ${escapeHtml(invite.status)}">${escapeHtml(invite.status)}</b>${invite.status === 'invited' ? `<button class="btn resend-setup-button" type="button" data-user-id="${escapeHtml(invite.user_id)}">Resend setup link</button>` : ''}</div>`).join('');
}

async function loadInviteStatus() {
  const list = document.querySelector('#inviteList');
  if (list) list.innerHTML = '<span class="permission-lock">Loading invite status…</span>';
  const { data, error } = await supabaseClient.functions.invoke(INVITE_FUNCTION, {
    body: { action: 'list', teamId: currentInviteTeamId() }
  });
  if (error) {
    console.warn('Could not load invite status:', error);
    if (list) list.innerHTML = `<span class="auth-error">${escapeHtml(error.message || 'Invite status is unavailable.')}</span>`;
    return;
  }
  renderInviteList(data?.invites || []);
}

function currentInviteTeamId() {
  if (!currentWorkspace?.authorized || !currentWorkspace?.team_id) {
    throw new Error('An authorized team workspace is required.');
  }
  return currentWorkspace.team_id;
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
    teamId: currentInviteTeamId(),
    displayName: form.querySelector('#inviteName').value.trim(),
    email: form.querySelector('#inviteEmail').value.trim(),
    roleId: form.querySelector('#inviteRole').value
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
    body: { action: 'resend_setup', teamId: currentInviteTeamId(), userId }
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

function switcherMarkup(kind, labelText, selectId, ariaLabel, options, selectedValue, singleValue, icon = '') {
  const iconMarkup = icon ? `<svg class="switcher-icon" aria-hidden="true"><use href="#icon-${icon}"></use></svg>` : '';
  if (singleValue != null) {
    return `${iconMarkup}<span class="${kind}-label">${labelText}</span><span class="switcher-value" title="${escapeHtml(singleValue)}">${escapeHtml(singleValue)}</span>`;
  }
  return `${iconMarkup}<label class="switcher-field"><span class="${kind}-label">${labelText}</span><span class="switcher-select"><select id="${selectId}" aria-label="${ariaLabel}">${options.map(option => `<option value="${escapeHtml(option.value)}" ${option.value === selectedValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select><span class="switcher-chevron" aria-hidden="true">▾</span></span></label>`;
}

function renderOrganizationSwitcher() {
  const host = document.querySelector('#organizationSwitcher');
  const organizations = organizationContextManager.context.organizations;
  if (!host || !organizations.length) return;
  if (organizations.length === 1) {
    host.innerHTML = switcherMarkup('organization-switcher', 'Organization', null, '', [], '', organizations[0].name, 'platform');
  } else {
    host.innerHTML = switcherMarkup('organization-switcher', 'Organization', 'organizationSelect', 'Selected organization',
      organizations.map(organization => ({ value: organization.id, label: organization.name })),
      organizationContextManager.context.selectedOrganizationId, undefined, 'platform');
    host.querySelector('#organizationSelect').addEventListener('change', event => selectOrganization(event.target.value));
  }
  host.hidden = false;
}

function renderTeamSwitcher() {
  const host = document.querySelector('#teamSwitcher');
  const teams = organizationContextManager.teamsForSelectedOrganization(workspaceAccessManager.context.workspaces);
  if (!host || !teams.length) return;
  if (teams.length === 1) {
    host.innerHTML = switcherMarkup('team-switcher', 'Team', null, '', [], '', teamContext.selectedMembership?.teams?.name || 'Selected team', 'team');
  } else {
    host.innerHTML = switcherMarkup('team-switcher', 'Team', 'teamSelect', 'Selected team',
      teams.map(workspace => ({ value: workspace.team_id, label: workspace.team_name || workspace.team_id })),
      teamContext.selectedTeamId, undefined, 'team');
    host.querySelector('#teamSelect').addEventListener('change', event => selectTeam(event.target.value));
  }
  host.hidden = false;
}

function renderTenantBranding() {
  const displayName = tenantName();
  const seasonName = tenantSeasonName();
  const mark = displayName.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'PN';
  const logoUrl = currentWorkspace?.branding?.logo_url || currentWorkspace?.branding?.logo || '';
  const tenantMark = document.querySelector('#tenantMark');
  const tenantNameNode = document.querySelector('#tenantName');
  const tenantSeasonLabel = document.querySelector('#tenantSeasonLabel');
  const tenantFooter = document.querySelector('#tenantFooter');
  const teamStatus = document.querySelector('#teamStatus');
  const branding = currentWorkspace?.branding || {};
  const rootStyle = document.documentElement?.style;
  if (rootStyle) {
    rootStyle.setProperty('--brand-primary', branding.primary_color || '#236c9e');
    rootStyle.setProperty('--brand-secondary', branding.secondary_color || '#102338');
    rootStyle.setProperty('--brand-accent', branding.accent_color || branding.primary_color || '#61d4f5');
    rootStyle.setProperty('--org-surface', branding.secondary_color || '#0c1b2c');
  }
  if (tenantMark) {
    if (logoUrl) {
      tenantMark.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(displayName)}" class="brand-logo-img">`;
    } else {
      tenantMark.textContent = mark;
    }
  }
  if (tenantNameNode) tenantNameNode.textContent = displayName;
  if (tenantSeasonLabel) tenantSeasonLabel.textContent = seasonName;
  if (tenantFooter) tenantFooter.textContent = displayName;
  if (teamStatus) teamStatus.textContent = `${displayName} · ${activeStaff?.role || 'Team workspace'}${currentWorkspace?.plan_id ? ` · ${currentWorkspace.plan_id}` : ''}`;
}

async function selectOrganization(organizationId) {
  if (organizationId === organizationContextManager.context.selectedOrganizationId) return;
  organizationContextManager.select(organizationId);
  const next = organizationContextManager.teamsForSelectedOrganization(workspaceAccessManager.context.workspaces)[0];
  if (!next) {
    clearTenantState();
    render();
    return;
  }
  await activateWorkspace(next.organization_id, next.team_id, next.season_id);
}

async function selectTeam(teamId) {
  if (teamId === teamContext.selectedTeamId) return;
  const next = organizationContextManager.teamsForSelectedOrganization(workspaceAccessManager.context.workspaces)
    .find(workspace => workspace.team_id === teamId);
  if (!next) throw new Error('That team is not authorized in the selected organization.');
  await activateWorkspace(next.organization_id, next.team_id, next.season_id);
}

function renderSeasonSwitcher() {
  const host = document.querySelector('#seasonSwitcher');
  if (!host || !seasonContext.seasons.length) return;
  if (seasonContext.seasons.length === 1) {
    host.innerHTML = switcherMarkup('season-switcher', 'Season', null, '', [], '', seasonContext.selectedSeason?.name || seasonContext.selectedSeason?.season_key || 'Selected season', 'calendar');
  } else {
    host.innerHTML = switcherMarkup('season-switcher', 'Season', 'seasonSelect', 'Selected season',
      seasonContext.seasons.map(season => ({ value: season.id, label: season.name || season.season_key })),
      seasonContext.selectedSeasonId, undefined, 'calendar');
    host.querySelector('#seasonSelect').addEventListener('change', event => selectSeason(event.target.value));
  }
  host.hidden = false;
}

async function selectSeason(seasonId) {
  if (seasonId === seasonContext.selectedSeasonId) return;
  if (!currentWorkspace) return;
  await activateWorkspace(currentWorkspace.organization_id, currentWorkspace.team_id, seasonId);
}

function clearTenantState() {
  phase1Data = null;
  phase1DataError = '';
  phase2AData = null;
  phase2ADataError = '';
  authTeam = null;
  authCapabilities = [];
  currentWorkspace = null;
  entitlements.clear();
  workspaceAccessManager.clearWorkspace();
  rosterManager.clearWorkspace();
  statsEntryManager.clearWorkspace();
  closeStatsEntry();
  teamContextManager.clearSelection();
  seasonContextManager.clear();
  const organizationSwitcher = document.querySelector('#organizationSwitcher');
  const teamSwitcher = document.querySelector('#teamSwitcher');
  const seasonSwitcher = document.querySelector('#seasonSwitcher');
  if (organizationSwitcher) organizationSwitcher.hidden = true;
  if (teamSwitcher) teamSwitcher.hidden = true;
  if (seasonSwitcher) seasonSwitcher.hidden = true;
  if (app) app.innerHTML = '';
}

function betaOnboardingValue(form, id) {
  return form.querySelector(`#${id}`).value.trim();
}

function betaOnboardingToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function betaOnboardingInviteUrl(token) {
  const url = new URL(location.href);
  url.hash = `invite_token=${encodeURIComponent(token)}`;
  return url.toString();
}

function betaOnboardingStatusMessage(message, kind = '') {
  const status = document.querySelector('#betaOnboardingStatus');
  if (!status) return;
  status.className = `invite-status${kind ? ` ${kind}` : ''}`;
  status.textContent = message;
}

async function betaOnboardingTokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function submitBetaOnboarding(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('#betaOnboardingStatus');
  button.disabled = true;
  button.textContent = 'Creating workspace…';
  status.className = 'invite-status';
  status.textContent = 'Validating Platform Admin authorization and creating the controlled Beta workspace…';
  try {
    const inviteToken = betaOnboardingToken();
    const tokenHash = await betaOnboardingTokenHash(inviteToken);
    const { data, error } = await supabaseClient.rpc('beta_onboard_workspace', {
      target_organization_name: betaOnboardingValue(form, 'onboardingOrganizationName'),
      target_organization_slug: betaOnboardingValue(form, 'onboardingOrganizationSlug'),
      target_team_name: betaOnboardingValue(form, 'onboardingTeamName'),
      target_team_slug: betaOnboardingValue(form, 'onboardingTeamSlug'),
      target_season_name: betaOnboardingValue(form, 'onboardingSeasonName'),
      target_season_key: betaOnboardingValue(form, 'onboardingSeasonKey'),
      target_season_starts_on: betaOnboardingValue(form, 'onboardingSeasonStartsOn'),
      target_season_ends_on: betaOnboardingValue(form, 'onboardingSeasonEndsOn'),
      target_plan_id: betaOnboardingValue(form, 'onboardingPlanId'),
      target_branding_display_name: betaOnboardingValue(form, 'onboardingBrandDisplayName'),
      target_branding_short_name: betaOnboardingValue(form, 'onboardingBrandShortName'),
      target_branding_logo_url: betaOnboardingValue(form, 'onboardingBrandLogoUrl'),
      target_branding_primary_color: betaOnboardingValue(form, 'onboardingBrandPrimaryColor'),
      target_branding_secondary_color: betaOnboardingValue(form, 'onboardingBrandSecondaryColor'),
      target_branding_accent_color: betaOnboardingValue(form, 'onboardingBrandAccentColor'),
      target_coach_email: betaOnboardingValue(form, 'onboardingCoachEmail'),
      target_coach_name: betaOnboardingValue(form, 'onboardingCoachName'),
      target_coach_role_id: betaOnboardingValue(form, 'onboardingCoachRoleId'),
      target_token_hash: tokenHash
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.organization_id || !result?.team_id || !result?.season_id || !result?.invite_id) {
      throw new Error('The onboarding request did not return a complete workspace.');
    }
    betaOnboardingSummary = {
      organizationName: betaOnboardingValue(form, 'onboardingOrganizationName'),
      teamName: betaOnboardingValue(form, 'onboardingTeamName'),
      seasonName: betaOnboardingValue(form, 'onboardingSeasonName'),
      planId: result.plan_id,
      recognitionLabel: result.recognition_label,
      inviteId: result.invite_id,
      inviteStatus: result.invite_status,
      coachEmail: betaOnboardingValue(form, 'onboardingCoachEmail'),
      inviteUrl: betaOnboardingInviteUrl(inviteToken)
    };
    render('platform-admin');
  } catch (error) {
    status.className = 'invite-status error';
    status.textContent = error.message || 'The Beta workspace could not be created. No partial workspace was saved.';
    button.disabled = false;
    button.textContent = 'Create Beta workspace';
  }
}

function bindBetaOnboardingControls() {
  const form = document.querySelector('#betaOnboardingForm');
  if (form) form.addEventListener('submit', submitBetaOnboarding);
  document.querySelector('#reissueBetaOnboardingInvite')?.addEventListener('click', reissueBetaOnboardingInvite);
  document.querySelector('#revokeBetaOnboardingInvite')?.addEventListener('click', revokeBetaOnboardingInvite);
}

async function reissueBetaOnboardingInvite(event) {
  if (!betaOnboardingSummary?.inviteId || event.currentTarget.disabled) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Reissuing…';
  try {
    const { data, error } = await supabaseClient.functions.invoke(BETA_ONBOARDING_REISSUE_FUNCTION, {
      body: { inviteId: betaOnboardingSummary.inviteId }
    });
    if (error) throw error;
    if (!data?.invite_id || !data?.token) {
      throw new Error('The reissued invitation did not return an acceptance token.');
    }
    betaOnboardingSummary = {
      ...betaOnboardingSummary,
      inviteId: data.invite_id,
      inviteStatus: data.status,
      inviteUrl: data.invite_url || betaOnboardingInviteUrl(data.token)
    };
    render('platform-admin');
  } catch (error) {
    betaOnboardingStatusMessage(error.message || 'The Beta onboarding invitation could not be reissued.', 'error');
    button.disabled = false;
    button.textContent = 'Reissue link';
  }
}

async function revokeBetaOnboardingInvite(event) {
  if (!betaOnboardingSummary?.inviteId || event.currentTarget.disabled) return;
  if (!window.confirm('Revoke the pending first-coach invitation? Its acceptance link will stop working immediately.')) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Revoking…';
  try {
    const { error } = await supabaseClient.rpc('revoke_beta_onboarding_invite', {
      target_invite_id: betaOnboardingSummary.inviteId
    });
    if (error) throw error;
    betaOnboardingSummary = {
      ...betaOnboardingSummary,
      inviteStatus: 'revoked',
      inviteUrl: ''
    };
    render('platform-admin');
  } catch (error) {
    betaOnboardingStatusMessage(error.message || 'The Beta onboarding invitation could not be revoked.', 'error');
    button.disabled = false;
    button.textContent = 'Revoke invitation';
  }
}

async function activateWorkspace(organizationId, teamId, seasonId = null) {
  if (workspaceTransitioning) return;
  workspaceTransitioning = true;
  clearTenantState();
  render();
  try {
    const workspace = await workspaceAccessManager.resolveWorkspace(organizationId, teamId, seasonId);
    currentWorkspace = workspace;
    workspaceAccessManager.persistPreference(workspace);
    rosterManager.setWorkspace(workspace);
    statsEntryManager.setWorkspace(workspace);
    organizationContextManager.select(workspace.organization_id);
    teamContextManager.selectWorkspace(workspace);
    authTeam = teamContext.selectedMembership;
    authCapabilities = workspace.effective_capabilities.slice();
    if (platformAdminAuthorized) authCapabilities.push('platform.admin');
    entitlements.setWorkspace(workspace);
    activeStaff = {
      ...activeStaff,
      roleId: workspace.role_id,
      role: workspace.role_label,
      capabilities: authCapabilities
    };
    const seasonState = await seasonContextManager.load(workspace.team_id, workspace.season_id, workspace);
    if (workspace.season_id && seasonState.selectedSeasonId !== workspace.season_id) {
      throw new Error('The selected season is not available for this authorized team.');
    }
    render();
    await Promise.all([loadPhase1Data(workspace.team_id), loadPhase2AData(workspace.team_id)]);
  } catch (error) {
    clearTenantState();
    console.error('Could not resolve the selected workspace:', error);
    render();
    throw error;
  } finally {
    workspaceTransitioning = false;
  }
}

async function loadSelectedTeam() {
  const membership = teamContext.selectedMembership;
  const workspace = membership?.workspace;
  if (!workspace) {
    await seasonContextManager.load(membership.team_id, membership.teams?.default_season_id);
    return;
  }
  await activateWorkspace(workspace.organization_id, workspace.team_id, workspace.season_id);
}

function renderWorkspaceIndicators() {
  const roleNode = document.querySelector('#workspaceRole');
  const planNode = document.querySelector('#workspacePlan');
  if (roleNode) roleNode.textContent = currentWorkspace?.role_label || 'No workspace';
  if (planNode) planNode.textContent = currentWorkspace?.plan_id || 'No plan';
}

function workspaceAuthorizedForView(view) {
  if (view === 'platform-admin') return hasPlatformAdminAuthorization();
  return Boolean(currentWorkspace?.authorized)
    && can(roleViews[view], activeStaff)
    && entitlements.isFeatureEnabled(viewFeatures[view]);
}

const NAV_SECTIONS = [
  { id: 'overview', views: ['command', 'team', 'schedule', 'games'] },
  { id: 'analytics', views: ['players', 'stats', 'film', 'scouting', 'reports'] },
  { id: 'coaching', views: ['development', 'coaching', 'management'] },
  { id: 'system', views: ['support', 'settings'] },
  { id: 'platform', views: ['platform-admin'] }
];

function hasPlatformAdminAuthorization() {
  return (typeof platformAdminAuthorized === 'boolean' && platformAdminAuthorized)
    || (Boolean(currentWorkspace?.authorized)
      && authCapabilities.includes('platform.admin'));
}

function navigationModel(authorizedForView, sections = NAV_SECTIONS) {
  return sections.map(section => {
    const items = section.views.map(view => ({ view, allowed: Boolean(authorizedForView(view)) }));
    return { id: section.id, items, visible: items.some(item => item.allowed) };
  });
}

function syncNavigation(view) {
  const model = navigationModel(workspaceAuthorizedForView);
  const visibleViews = new Set(model.flatMap(section => section.items.filter(item => item.allowed).map(item => item.view)));
  nav.forEach(item => {
    const allowed = visibleViews.has(item.dataset.view);
    item.hidden = !allowed;
    item.classList.toggle('active', item.dataset.view === view);
    item.toggleAttribute('aria-current', item.dataset.view === view);
  });
  model.forEach(section => {
    document.querySelectorAll(`.nav-label[data-section="${section.id}"]`).forEach(label => { label.hidden = !section.visible; });
  });
  return model;
}

function noWorkspacePage() {
  return '<section class="card empty-view"><div class="empty-icon">⌁</div><h2>No authorized workspace</h2><p>Your account is authenticated, but no active team membership is available yet. Accept an approved invitation or ask a workspace owner for access.</p></section>';
}

function workspaceLoadingPage() {
  return '<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Resolving workspace</h2><p>Verifying organization, team, season, role, capabilities, and entitlements.</p></section>';
}

function workspaceUnavailablePage() {
  return '<section class="card empty-view"><div class="empty-icon">!</div><h2>Workspace unavailable</h2><p>The selected workspace is no longer authorized. Previous workspace data has been cleared.</p></section>';
}

function rosterFormValues() {
  return {
    jersey_number: document.querySelector('#playerJersey')?.value,
    first_name: document.querySelector('#playerFirstName')?.value,
    last_name: document.querySelector('#playerLastName')?.value,
    position: document.querySelector('#playerPosition')?.value,
    player_type: document.querySelector('#playerType')?.value,
    shoots: document.querySelector('#playerShoots')?.value,
    status: document.querySelector('#playerStatus')?.value,
    notes: document.querySelector('#playerNotes')?.value
  };
}

async function refreshRoster() {
  if (!currentWorkspace) return;
  await loadPhase1Data(currentWorkspace.team_id);
  render('players');
}

function showPlayerDialog(player = null) {
  const dialog = document.querySelector('#playerDialog');
  if (!dialog) return;
  dialog.querySelector('#playerDialogTitle').textContent = player ? 'Edit Player' : 'Add Player';
  dialog.querySelector('.modal-card form').outerHTML = playerForm(player || {});
  dialog.hidden = false;
  dialog.querySelector('#cancelPlayerForm').addEventListener('click', () => { dialog.hidden = true; });
  dialog.querySelector('#playerForm').addEventListener('submit', async event => {
    event.preventDefault();
    const status = dialog.querySelector('#playerFormStatus');
    status.textContent = 'Saving…';
    try {
      const playerId = dialog.querySelector('#playerId').value;
      if (playerId) await rosterManager.updatePlayer(playerId, rosterFormValues());
      else await rosterManager.createPlayer(rosterFormValues());
      dialog.hidden = true;
      await refreshRoster();
    } catch (error) {
      status.textContent = error.message || 'Player could not be saved.';
    }
  });
}

function downloadRosterTemplate() {
  const blob = new Blob([rosterManager.downloadTemplate()], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'pucknexus-roster-template.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

function statsEntryDraftMap(playerType) {
  return playerType === 'goalie' ? statsEntryDraft?.goalies : statsEntryDraft?.skaters;
}

function collectStatsEntryTeamForm() {
  const form = document.querySelector('#statsEntryTeamForm');
  if (!form || !statsEntryDraft) return;
  form.querySelectorAll('[data-stats-team-field]').forEach(input => {
    statsEntryDraft.team[input.dataset.statsTeamField] = window.FoxesStatsEntry.parseStatValue(input.value);
  });
}

function bindGameCenterControls() {
  document.querySelectorAll('[data-enter-stats]').forEach(button => button.addEventListener('click', () => openStatsEntry(button.dataset.enterStats)));
  if (!statsEntryGameId) return;
  document.querySelector('#cancelStatsEntry')?.addEventListener('click', () => { closeStatsEntry(); render('games'); });
  document.querySelectorAll('.stat-entry-step').forEach(button => button.addEventListener('click', () => {
    if (statsEntryStep === 'team') collectStatsEntryTeamForm();
    statsEntryStep = button.dataset.statsStep;
    statsEntryError = '';
    render('games');
  }));
  document.querySelector('#nextStatsStep')?.addEventListener('click', () => {
    if (statsEntryStep === 'team') collectStatsEntryTeamForm();
    const index = STATS_ENTRY_STEPS.findIndex(([key]) => key === statsEntryStep);
    statsEntryStep = STATS_ENTRY_STEPS[Math.min(index + 1, STATS_ENTRY_STEPS.length - 1)][0];
    statsEntryError = '';
    render('games');
  });
  // Input updates write directly into the draft without re-rendering, so
  // native tab order and cursor position are preserved for fast entry.
  document.querySelectorAll('.stat-cell-input[data-stats-player]').forEach(input => {
    input.addEventListener('input', () => {
      const map = statsEntryDraftMap(input.dataset.statsType);
      const row = map?.get(input.dataset.statsPlayer);
      if (row) row[input.dataset.statsField] = window.FoxesStatsEntry.parseStatValue(input.value);
    });
  });
  document.querySelector('#saveStatsEntry')?.addEventListener('click', async () => {
    if (!statsEntryDraft) return;
    statsEntrySaving = true;
    statsEntryError = '';
    statsEntrySavedMessage = '';
    render('games');
    try {
      const skaterRows = [...statsEntryDraft.skaters.entries()].map(([source_player_id, row]) => ({ source_player_id, ...row }));
      const goalieRows = [...statsEntryDraft.goalies.entries()].map(([source_player_id, row]) => ({ source_player_id, ...row }));
      await statsEntryManager.save(statsEntryGameId, { skaterRows, goalieRows, teamStats: statsEntryDraft.team });
      await loadPhase1Data(currentWorkspace.team_id);
      statsEntryDraft = null;
      statsEntrySavedMessage = 'Game stats saved. The Stats Dashboard reflects this game now.';
      statsEntrySaving = false;
      render('games');
    } catch (error) {
      statsEntrySaving = false;
      statsEntryError = error.message || 'Game stats could not be saved.';
      render('games');
    }
  });
}

function bindRosterControls() {
  if (!rosterCanManage()) return;
  document.querySelector('#addPlayerButton')?.addEventListener('click', () => showPlayerDialog());
  document.querySelector('#importRosterButton')?.addEventListener('click', () => {
    const dialog = document.querySelector('#importDialog');
    if (dialog) dialog.hidden = false;
  });
  document.querySelector('#downloadRosterTemplate')?.addEventListener('click', downloadRosterTemplate);
  document.querySelector('#closePlayerDialog')?.addEventListener('click', () => { document.querySelector('#playerDialog').hidden = true; });
  document.querySelector('#closeImportDialog')?.addEventListener('click', () => { document.querySelector('#importDialog').hidden = true; });
  document.querySelector('#rosterFilter')?.addEventListener('change', event => { rosterFilter = event.target.value; render('players'); });
  document.querySelector('#rosterSearch')?.addEventListener('input', event => { rosterSearch = event.target.value; render('players'); });
  document.querySelectorAll('.roster-edit').forEach(button => button.addEventListener('click', () => {
    const player = phase1Data?.roster?.find(row => row.id === button.dataset.playerId);
    if (player) showPlayerDialog(player);
  }));
  document.querySelectorAll('.roster-toggle').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (button.dataset.status === 'inactive') await rosterManager.deactivatePlayer(button.dataset.playerId);
      else await rosterManager.reactivatePlayer(button.dataset.playerId);
      await refreshRoster();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message || 'Player status could not be changed.');
    }
  }));
  document.querySelector('#rosterFile')?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    const preview = document.querySelector('#importPreview');
    const confirm = document.querySelector('#confirmRosterImport');
    if (!file || !preview || !confirm) return;
    const rows = rosterManager.parseCsv(await file.text());
    const result = rosterManager.validateImport(rows, phase1Data?.roster || []);
    rosterImportPreview = { rows, result };
    preview.innerHTML = `<strong>${rows.length} row${rows.length === 1 ? '' : 's'} detected</strong><br>${result.errors.length ? `<span class="auth-error">${result.errors.length} invalid row${result.errors.length === 1 ? '' : 's'} rejected.</span><br>` : ''}${result.duplicates.length ? `<span class="permission-lock">${result.duplicates.length} possible duplicate${result.duplicates.length === 1 ? '' : 's'} found. Confirm to import them anyway.</span>` : ''}${result.valid.length ? `<span>${result.valid.length} row${result.valid.length === 1 ? '' : 's'} ready to import.</span>` : ''}`;
    confirm.disabled = !result.valid.length && !result.duplicates.length;
  });
  document.querySelector('#confirmRosterImport')?.addEventListener('click', async () => {
    if (!rosterImportPreview) return;
    const { rows, result } = rosterImportPreview;
    const allowDuplicates = result.duplicates.length ? window.confirm('Possible duplicates were found. Import them anyway?') : false;
    if (result.duplicates.length && !allowDuplicates) return;
    const confirm = document.querySelector('#confirmRosterImport');
    confirm.disabled = true;
    try {
      await rosterManager.importPlayers(rows, { allowDuplicates, existing: phase1Data?.roster || [] });
      document.querySelector('#importDialog').hidden = true;
      rosterImportPreview = null;
      await refreshRoster();
    } catch (error) {
      document.querySelector('#importPreview').innerHTML = `<span class="auth-error">${escapeHtml(error.message || 'Roster import failed.')}</span>`;
      confirm.disabled = false;
    }
  });
}

function renderRoleSwitcher() {
  document.querySelector('#userAvatar').textContent = activeStaff.initials;
  document.querySelector('#userName').textContent = activeStaff.name;
  const sidebarUser = document.querySelector('#sidebarUser');
  if (sidebarUser) {
    sidebarUser.innerHTML = `<span class="sidebar-user-avatar">${escapeHtml(activeStaff.initials || '–')}</span><span class="sidebar-user-copy"><strong>${escapeHtml(activeStaff.name || 'Team member')}</strong><small>${escapeHtml(activeStaff.role || 'Authenticated user')}</small></span>`;
  }
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
  if (!currentWorkspace && !hasPlatformAdminAuthorization()) {
    app.innerHTML = workspaceTransitioning
      ? workspaceLoadingPage()
      : (authUser ? workspaceUnavailablePage() : noWorkspacePage());
    renderWorkspaceIndicators();
    return;
  }
  if (!currentWorkspace) view = 'platform-admin';
  if (!workspaceAuthorizedForView(view)) view = 'command';
  const page = view === 'platform-admin'
    ? platformAdmin()
    : view === 'scouting'
      ? scouting()
    : phase1DataError
      ? shell('Team data unavailable', 'The authenticated workspace is available, but the live team data could not be read.', `<section class="card empty-view"><div class="empty-icon">!</div><h2>Unable to load synced team data</h2><p>${escapeHtml(phase1DataError)}</p><button class="btn primary" id="retryPhase1Data" type="button">Retry</button></section>`)
      : !phase1Data
        ? shell('Loading team data', 'Reading the live team roster, schedule, games, and stats…', '<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Loading synced team data</h2><p>Please wait while the secure workspace reads your team data.</p></section>')
        : view === 'command' ? command() : view === 'team' ? team() : view === 'schedule' ? schedule() : view === 'stats' ? stats() : view === 'players' ? players() : view === 'games' ? gameCenter() : view === 'film' ? film() : view === 'reports' ? reports() : view === 'development' ? development() : view === 'coaching' ? coaching() : view === 'management' ? management() : view === 'settings' ? settings() : view === 'support' ? support() : generic(view);
  const planNotice = currentWorkspace?.authorized && !currentWorkspace?.plan_id
    ? notice('This workspace does not have an active plan entitlement yet, so plan-gated modules and data stay hidden. Contact your organization administrator to provision the workspace plan.')
    : '';
  app.innerHTML = planNotice + page;
  document.querySelector('#viewCrumb').textContent = viewNames[view]; renderRoleSwitcher();
  renderWorkspaceIndicators();
  renderOrganizationSwitcher();
  renderTeamSwitcher();
  renderSeasonSwitcher();
  renderTenantBranding();
  const seasonPill = document.querySelector('#seasonPill');
  if (seasonPill) seasonPill.firstChild.textContent = tenantSeasonName();
  document.querySelector('#retryPhase1Data')?.addEventListener('click', () => loadPhase1Data(authTeam.team_id));
  document.querySelector('#retryPhase2AData')?.addEventListener('click', () => loadPhase2AData(authTeam.team_id));
  if (view === 'stats') {
    app.querySelectorAll('[data-sort-key]').forEach(button => button.addEventListener('click', () => {
      const key = button.dataset.sortKey;
      if (statsSortKey === key) statsSortDir = statsSortDir === 'asc' ? 'desc' : 'asc';
      else {
        statsSortKey = key;
        statsSortDir = key === 'name' || key === 'position' || key === 'jersey_number' ? 'asc' : 'desc';
      }
      render('stats');
    }));
  }
  if (view === 'management') bindAdminControls();
  if (view === 'platform-admin') bindBetaOnboardingControls();
  if (view === 'players') bindRosterControls();
  if (view === 'games') bindGameCenterControls();
  if (view === 'support') bindSupportControls();
  syncNavigation(view);
  document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#scrim').classList.remove('show'); window.scrollTo(0, 0);
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
  const read = (key, table, columns, capability, transform = rows => rows || []) => {
    if (!can(capability, activeStaff)) return;
    requests.push(supabaseClient.from(table).select(columns).eq('team_id', teamId).then(({ data, error }) => {
      if (error) throw new Error(`${key}: ${error.message}`);
      return [key, transform(data)];
    }));
  };
  read('roster', 'team_roster_players', 'id,team_id,season_id,source_player_id,jersey_number,name,first_name,last_name,position,player_type,shoots,notes,status', PERMISSIONS.PLAYERS_VIEW);
  read('schedule', 'team_schedule_games', 'source_schedule_id,date,time,opponent,home_away,game_type,location,notes,linked_game_source_id', PERMISSIONS.SCHEDULE_VIEW);
  read('games', 'team_games', 'source_game_id,date,opponent,period_length_min', PERMISSIONS.GAMES_VIEW);
  read('playerStats', 'team_game_player_stats', 'source_game_id,source_player_id,player_type,gp,goals,assists,shots,penalty_minutes,plus_minus,blocks,faceoff_wins,faceoff_losses,faceoff_attempts,power_play_goals,power_play_assists,power_play_points,short_handed_goals,short_handed_assists,short_handed_points,game_winning_goals,game_tying_goals,takeaways,giveaways,chances,toi_minutes,minutes,saves,goals_against,wins,losses,ties,shutouts', PERMISSIONS.STATS_VIEW);
  read('teamStats', 'team_game_team_stats', 'source_game_id,goals_for,goals_against,shots_for,shots_against,power_play_chances,power_play_success,penalty_kill_chances,penalty_kill_success,faceoff_wins,faceoff_losses', PERMISSIONS.STATS_VIEW);
  const seasonRequest = can(PERMISSIONS.REPORTS_VIEW, activeStaff)
    ? supabaseClient.from('team_season_records').select('season_key,games_played,wins,losses,ties,goals_for,goals_against,source_game_count').eq('team_id', teamId).order('computed_at', { ascending: false }).limit(1).maybeSingle().then(({ data, error }) => { if (error) throw new Error(`season record: ${error.message}`); return ['seasonRecord', data]; })
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

async function acceptWorkspaceInviteForSignedInUser() {
  if (!workspaceInviteToken || inviteAcceptanceAttempted) return false;
  inviteAcceptanceAttempted = true;
  try {
    const { error } = await supabaseClient.functions.invoke(WORKSPACE_INVITE_ACCEPT_FUNCTION, {
      body: { token: workspaceInviteToken }
    });
    if (error) throw new Error(error.message || 'The workspace invitation could not be accepted.');
    window.history.replaceState({}, document.title, `${location.pathname}${location.search}`);
    return true;
  } catch (error) {
    inviteAcceptanceAttempted = false;
    throw error;
  }
}

async function loadAuthenticatedWorkspace(sessionUser = null) {
  if (activeStaff && currentWorkspace) return;
  if (workspaceTransitioning) return;
  workspaceTransitioning = true;
  try {
    const user = sessionUser || (await supabaseClient.auth.getSession()).data.session?.user;
    if (!user) {
      showLogin();
      return;
    }
    await acceptWorkspaceInviteForSignedInUser();
    const { data: profile, error: profileError } = await supabaseClient.from('profiles').select('id,display_name').eq('id', user.id).single();
    let workspaces = [];
    let workspaceError = null;
    try {
      workspaces = await workspaceAccessManager.loadAuthorizedWorkspaces();
    } catch (error) {
      workspaceError = error;
      console.error('Could not load authorized workspaces:', error);
    }
    if (profileError || workspaceError || !profile) {
      showLogin(workspaceError?.message || 'Your authenticated profile could not be loaded.');
      return;
    }
    authUser = user;
    activeStaff = {
      id: user.id,
      name: profile.display_name,
      initials: profile.display_name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(),
      roleId: '',
      role: 'Authenticated user',
      capabilities: []
    };
    const { data: platformAuthorization, error: platformAuthorizationError } = await supabaseClient
      .rpc('get_platform_authorization');
    platformAdminAuthorized = !platformAuthorizationError
      && (Array.isArray(platformAuthorization) ? platformAuthorization[0]?.platform_admin : platformAuthorization?.platform_admin) === true;
    if (platformAuthorizationError) {
      console.warn('Platform authorization could not be loaded:', platformAuthorizationError);
    }
    organizationContextManager.load(workspaces);
    teamContextManager.setAuthorizedWorkspaces(workspaces);
    if (!workspaces.length) {
      clearTenantState();
      render(platformAdminAuthorized ? 'platform-admin' : 'command');
      appShell.hidden = false;
      appShell.removeAttribute('aria-hidden');
      authScreen.hidden = true;
      authScreen.setAttribute('aria-hidden', 'true');
      return;
    }
    const selected = workspaceAccessManager.chooseWorkspace();
    workspaceTransitioning = false;
    await activateWorkspace(selected.organization_id, selected.team_id, selected.season_id);
    appShell.hidden = false;
    appShell.removeAttribute('aria-hidden');
    authScreen.hidden = true;
    authScreen.setAttribute('aria-hidden', 'true');
  } catch (error) {
    authUser = null;
    activeStaff = null;
    platformAdminAuthorized = false;
    clearTenantState();
    console.error('Could not load the authenticated workspace:', error);
    showLogin('Unable to load your secure team workspace.');
  } finally {
    workspaceTransitioning = false;
  }
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    console.error('Could not sign out:', error);
    return;
  }
  authUser = null;
  activeStaff = null;
  platformAdminAuthorized = false;
  betaOnboardingSummary = null;
  inviteAcceptanceAttempted = false;
  organizationContextManager.clear();
  teamContextManager.clearSelection();
  clearTenantState();
  showLogin();
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryMode = true;
    showPasswordRecovery();
    return;
  }
  if (event === 'SIGNED_IN' && session?.user && !activeStaff) {
    setTimeout(() => loadAuthenticatedWorkspace(session.user), 0);
    return;
  }
  if (!session && activeStaff) {
    authUser = null;
    activeStaff = null;
    platformAdminAuthorized = false;
    betaOnboardingSummary = null;
    inviteAcceptanceAttempted = false;
    organizationContextManager.clear();
    teamContextManager.clearSelection();
    clearTenantState();
    showLogin();
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
  // Login-first bootstrap: unauthenticated visitors always see the sign-in
  // screen immediately while an existing Supabase session is restored.
  showLogin();

  supabaseClient.auth.getSession()
    .then(({ data: { session }, error }) => {
      if (error) throw error;

      if (session?.user) {
        showLoading();
        return loadAuthenticatedWorkspace(session.user);
      }

      return null;
    })
    .catch(error => {
      console.error('Unable to restore Supabase session:', error);
      workspaceTransitioning = false;
      showLogin('Unable to restore your Supabase session.');
    });
}