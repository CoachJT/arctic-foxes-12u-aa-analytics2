const { PERMISSIONS, STAFF, can } = window.FoxesPermissions;
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
let phase1Data = null;
let phase1DataError = '';
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const queryParams = new URLSearchParams(location.search);
const authCallbackPresent = ['access_token', 'refresh_token', 'type', 'code', 'error', 'error_code']
  .some(key => hashParams.has(key) || queryParams.has(key));
const recoveryCallbackPresent = hashParams.get('type') === 'recovery'
  || queryParams.get('type') === 'recovery';
const prototypeMode = !authCallbackPresent
  && location.hostname === 'localhost'
  && queryParams.get('prototype') === '1';

const viewNames = { command: 'Command Center', schedule: 'Schedule', stats: 'Team Stats', players: 'Player Profiles', games: 'Game Center', scouting: 'Scouting', reports: 'Coach Reports', admin: 'Admin', settings: 'Settings' };
const roleViews = { command: PERMISSIONS.DASHBOARD_VIEW, schedule: PERMISSIONS.SCHEDULE_VIEW, stats: PERMISSIONS.STATS_VIEW, players: PERMISSIONS.PLAYERS_VIEW, games: PERMISSIONS.GAMES_VIEW, scouting: PERMISSIONS.SCOUTING_VIEW, reports: PERMISSIONS.REPORTS_VIEW, admin: PERMISSIONS.ADMIN_USERS, settings: PERMISSIONS.DASHBOARD_VIEW };

function cardTitle(title, link = '') { return `<div class="card-title"><h2>${title}</h2>${link ? `<a href="#">${link} →</a>` : ''}</div>`; }
function shell(title, subtitle, body) { return `<div class="page-head"><div><div class="eyebrow">Arctic Foxes · Live team workspace</div><h1>${title}</h1><p>${subtitle}</p></div></div>${body}`; }
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
function leaders() {
  const stats = playerStatTotals();
  return (phase1Data?.roster || []).map(player => ({ player, totals: stats.get(player.source_player_id) || {} }))
    .sort((a, b) => (phase1Number(b.totals.goals) + phase1Number(b.totals.assists)) - (phase1Number(a.totals.goals) + phase1Number(a.totals.assists)))
    .slice(0, 4)
    .map(({ player, totals }) => `<div class="leader"><span class="jersey">#${escapeHtml(player.jersey_number)}</span><div><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(player.position)} · ${phase1Number(totals.games)} GP</small></div><span class="leader-value">${phase1Number(totals.goals) + phase1Number(totals.assists)} P</span></div>`).join('');
}
function recent() {
  const statByGame = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  return (phase1Data?.games || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 4).map(game => {
    const stat = statByGame.get(game.source_game_id) || {};
    const gf = phase1Number(stat.goals_for);
    const ga = phase1Number(stat.goals_against);
    const result = gf > ga ? 'W' : gf < ga ? 'L' : 'T';
    return `<div class="game-row"><div><strong>${escapeHtml(game.opponent)}</strong><small>${phase1Date(game.date)}</small></div><span class="score">${gf}–${ga}</span><span class="result ${result === 'W' ? 'win' : result === 'L' ? 'loss' : ''}">${result === 'W' ? 'WIN' : result === 'L' ? 'LOSS' : 'TIE'}</span><span class="arrow">›</span></div>`;
  }).join('');
}

function command() {
  const record = phase1Record();
  const next = (phase1Data?.schedule || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  return shell('Good morning, Coach.', 'Here is the live team picture from Supabase.', `<div class="grid hero-grid"><section class="card next-game">${cardTitle('NEXT GAME', 'Schedule')}<div class="game-top"><div class="opponent"><div class="opponent-mark">${escapeHtml(String(next?.opponent || 'AF').slice(0, 2).toUpperCase())}</div><div><p>${next ? `${phase1Date(next.date)} · ${escapeHtml(next.home_away)}` : 'No scheduled games'}</p><h2>${escapeHtml(next?.opponent || 'No upcoming game')}</h2><p>${escapeHtml(next?.location || 'Schedule details unavailable')}${next?.time ? ` · ${escapeHtml(next.time)}` : ''}</p></div></div><span class="home-pill">${escapeHtml(next?.home_away || '—')}</span></div><div class="game-date"><strong>${phase1Data?.schedule?.length || 0} <span>scheduled</span></strong><span>${phase1Data?.games?.length || 0} completed games synced</span></div></section><section class="card record-card">${cardTitle('SEASON RECORD', 'View schedule')}<div class="record"><span class="record-number">${record.wins}<span>–</span>${record.losses}<span>–</span>${record.ties}</span><div class="record-copy"><strong>${record.games_played} games played</strong>${record.goals_for} goals for<br>${record.goals_against} goals against</div></div></section></div><div class="grid stat-grid">${[['GOALS FOR / GAME', (record.goals_for / Math.max(record.games_played, 1)).toFixed(2), 'From synced team games'],['GOALS AGAINST / GAME', (record.goals_against / Math.max(record.games_played, 1)).toFixed(2), 'From synced team games'],['SCHEDULED GAMES', String(phase1Data?.schedule?.length || 0), 'Live Supabase schedule'],['ROSTER', String(phase1Data?.roster?.length || 0), 'Live Supabase roster']].map(x => `<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}</div><div class="grid split"><section class="card">${cardTitle('TOP PLAYERS', 'Player Profiles')}${leaders()}</section><section class="card recent">${cardTitle('RECENT GAMES', 'Game Center')}${recent()}</section></div>`);
}
function schedule() { return shell('Schedule','Live schedule synced from the Arctic Foxes Windows app.',`<section class="card">${cardTitle(`Team schedule · ${phase1Data?.schedule?.length || 0} entries`,'Supabase read-only')}<div class="schedule-list">${(phase1Data?.schedule || []).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(game=>`<div class="schedule-item"><div class="schedule-date"><strong>${escapeHtml(new Date(`${game.date}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'2-digit'}).toUpperCase())}</strong>${escapeHtml(String(game.date).slice(0,4))}</div><div><h3>${escapeHtml(game.opponent)}</h3><p>${escapeHtml(game.home_away)} · ${escapeHtml(game.location || 'Location unavailable')}${game.time ? ` · ${escapeHtml(game.time)}` : ''}</p></div><span class="tag">${escapeHtml(game.game_type)}</span></div>`).join('') || '<div class="empty-view"><h2>No schedule entries</h2><p>No synced schedule entries are available for this team.</p></div>'}</div></section>`); }
function stats() { const edit = can(PERMISSIONS.STATS_EDIT_OFFICIAL, activeStaff); const record = phase1Record(); const teamStats = phase1Data?.teamStats || []; const totals = teamStats.reduce((sum, row) => ({ shots: sum.shots + phase1Number(row.shots_for), pp: sum.pp + phase1Number(row.power_play_success), ppChances: sum.ppChances + phase1Number(row.power_play_chances), foW: sum.foW + phase1Number(row.faceoff_wins), foL: sum.foL + phase1Number(row.faceoff_losses) }), { shots: 0, pp: 0, ppChances: 0, foW: 0, foL: 0 }); return shell('Team Stats','Read-only statistics from the synced Arctic Foxes game data.',`<div class="grid stat-grid">${[['RECORD',`${record.wins}–${record.losses}–${record.ties}`,`${record.games_played} games`],['SHOTS / GAME',(totals.shots / Math.max(teamStats.length,1)).toFixed(1),'From team game stats'],['FACE-OFFS',`${((totals.foW / Math.max(totals.foW + totals.foL,1)) * 100).toFixed(1)}%`,'From team game stats'],['PLAYER-STAT ROWS',String(phase1Data?.playerStats?.length || 0),'Synced player-stat rows']].map(x=>`<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}</div><section class="card">${cardTitle('Season overview','Supabase read-only')}${edit ? '<span class="permission-lock">Official stat editing remains disabled in this web read-only phase.</span>' : '<span class="permission-lock">Statistics are read-only for this phase.</span>'}<div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th><th>Total</th><th>Average / rate</th></tr></thead><tbody>${[['Goals for',record.goals_for, (record.goals_for / Math.max(record.games_played,1)).toFixed(2)],['Goals against',record.goals_against,(record.goals_against / Math.max(record.games_played,1)).toFixed(2)],['Shots on goal',totals.shots,(totals.shots / Math.max(teamStats.length,1)).toFixed(1)],['Power-play successes',totals.pp,`${totals.ppChances ? ((totals.pp / totals.ppChances) * 100).toFixed(1) : '0.0'}%`],['Face-off wins',totals.foW,`${((totals.foW / Math.max(totals.foW + totals.foL,1)) * 100).toFixed(1)}%`]].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div></section>`); }
function players() { const totals = playerStatTotals(); return shell('Player Profiles','Live roster and basic player stats from Supabase.',`<section class="card">${cardTitle(`Roster · ${phase1Data?.roster?.length || 0} players`,'Supabase read-only')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Position</th><th>Games</th><th>Goals</th><th>Points</th><th>+ / −</th><th>Status</th></tr></thead><tbody>${(phase1Data?.roster || []).map(player=>{const stat=totals.get(player.source_player_id)||{}; return `<tr><td><div class="player-cell"><span class="player-photo">${escapeHtml(player.jersey_number)}</span><strong>${escapeHtml(player.name)}</strong></div></td><td class="role">${escapeHtml(player.position)}</td><td>${phase1Number(stat.games)}</td><td>${phase1Number(stat.goals)}</td><td>${phase1Number(stat.goals)+phase1Number(stat.assists)}</td><td class="trend-up">${phase1Number(stat.plus_minus)}</td><td><span class="tag">${can(PERMISSIONS.PLAYERS_EVALUATE, activeStaff) ? 'Evaluate' : 'View only'}</span></td></tr>`;}).join('') || '<tr><td colspan="7">No roster data is available.</td></tr>'}</tbody></table></div></section>`); }
function admin() {
  const owner = can(PERMISSIONS.ADMIN_USERS, activeStaff);
  return shell('Admin', 'Set up the people and access model for the team.', `${owner
    ? `<section class="card">${cardTitle('Accounts & permissions', 'Database-enforced Owner controls')}
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
  list.innerHTML = invites.map(invite => `<div class="invite-row"><div><strong>${escapeHtml(invite.display_name || 'Pending staff member')}</strong><small>${escapeHtml(invite.email || 'Email hidden')}</small></div><span>${escapeHtml(inviteRoleLabel(invite.role_id))}</span><b class="invite-badge ${escapeHtml(invite.status)}">${escapeHtml(invite.status)}</b></div>`).join('');
}

async function loadInviteStatus() {
  const list = document.querySelector('#inviteList');
  if (list) list.innerHTML = '<span class="permission-lock">Loading invite status…</span>';
  const { data, error } = await supabaseClient.functions.invoke(INVITE_FUNCTION, { body: { action: 'list' } });
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
    teamSlug: 'arctic-foxes-12u-aa'
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

function bindAdminControls() {
  const form = document.querySelector('#inviteForm');
  if (!form) return;
  form.addEventListener('submit', submitStaffInvite);
  document.querySelector('#refreshInvites')?.addEventListener('click', loadInviteStatus);
  loadInviteStatus();
}
function generic(view) { const titles = { games:['Game Center','One place for game-day details and post-game review.'], scouting:['Scouting','Prepare opponent notes and share the plan with the bench.'], reports:['Coach Reports','Turn team observations into clear, shareable reports.'], settings:['Settings','Configure the team hub experience and future integrations.'] }; const [title, sub] = titles[view]; const goalie = view === 'scouting' && can(PERMISSIONS.GOALIE_ANALYTICS_VIEW, activeStaff); return shell(title, sub, `<section class="card empty-view"><div class="empty-icon">${view === 'settings' ? '⚙' : '✦'}</div><h2>${goalie ? 'Goalie analytics access enabled' : 'Your next workspace layer'}</h2><p>This team workspace reserves the workflow for ${title.toLowerCase()}. ${goalie ? 'Database-provided goalie analytics access is enabled for this membership.' : 'This surface is ready to connect to synced analytics, schedules, scouting notes, reports, and player information.'}</p></section>`); }

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
  app.innerHTML = phase1DataError
    ? shell('Team data unavailable', 'The authenticated workspace is available, but the live Phase 1 data could not be read.', `<section class="card empty-view"><div class="empty-icon">!</div><h2>Unable to load synced team data</h2><p>${escapeHtml(phase1DataError)}</p><button class="btn primary" id="retryPhase1Data" type="button">Retry</button></section>`)
    : !phase1Data
      ? shell('Loading team data', 'Reading the live Arctic Foxes roster, schedule, games, and stats…', '<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Loading synced team data</h2><p>Please wait while the secure workspace reads your team data.</p></section>')
      : view === 'command' ? command() : view === 'schedule' ? schedule() : view === 'stats' ? stats() : view === 'players' ? players() : view === 'admin' ? admin() : generic(view);
  document.querySelector('#viewCrumb').textContent = viewNames[view]; renderRoleSwitcher();
  const seasonPill = document.querySelector('#seasonPill');
  if (seasonPill) seasonPill.firstChild.textContent = phase1Data?.seasonRecord?.season_key || 'Live season';
  document.querySelector('#retryPhase1Data')?.addEventListener('click', () => loadPhase1Data(authTeam.team_id));
  if (view === 'admin') bindAdminControls();
  nav.forEach(item => { const allowed = can(roleViews[item.dataset.view], activeStaff); item.hidden = !allowed; item.classList.toggle('active', item.dataset.view === view); item.toggleAttribute('aria-current', item.dataset.view === view); });
  document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#scrim').classList.remove('show'); window.scrollTo(0, 0);
}
nav.forEach(item => item.addEventListener('click', () => render(item.dataset.view)));
document.querySelector('#openSidebar').addEventListener('click', () => { document.querySelector('#sidebar').classList.add('open'); document.querySelector('#scrim').classList.add('show'); });
document.querySelector('#closeSidebar').addEventListener('click', () => { document.querySelector('#sidebar').classList.remove('open'); document.querySelector('#scrim').classList.remove('show'); });
document.querySelector('#scrim').addEventListener('click', () => document.querySelector('#closeSidebar').click());
function showLoading() {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.innerHTML = '<div class="auth-card"><div class="auth-brand"><div class="brand-mark">AF</div><div><strong>Arctic Foxes</strong><span>12U AA · TEAM HUB</span></div></div><h1>Restoring your session</h1><p class="auth-loading">Connecting to the secure team workspace…</p></div>';
}

function showLogin(error = '') {
  appShell.hidden = true;
  authScreen.hidden = false;
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="brand-mark">AF</div><div><strong>Arctic Foxes</strong><span>12U AA · TEAM HUB</span></div></div><h1>Sign in to your team hub</h1><p>Use your Arctic Foxes Supabase account to access the live workspace.</p><form class="auth-form" id="loginForm"><label>Email<input id="loginEmail" type="email" autocomplete="username" required /></label><label>Password<input id="loginPassword" type="password" autocomplete="current-password" required /></label>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}<button class="btn primary" type="submit">Sign in</button></form></div>`;
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
  authScreen.innerHTML = `<div class="auth-card"><div class="auth-brand"><div class="brand-mark">AF</div><div><strong>Arctic Foxes</strong><span>12U AA · TEAM HUB</span></div></div><h1>Set a new password</h1><p>Choose a new password for your Arctic Foxes account.</p><form class="auth-form" id="recoveryForm"><label>New password<input id="recoveryPassword" type="password" autocomplete="new-password" minlength="8" required /></label><label>Confirm new password<input id="recoveryPasswordConfirm" type="password" autocomplete="new-password" minlength="8" required /></label>${error ? `<div class="auth-error" role="alert">${escapeHtml(error)}</div>` : ''}<button class="btn primary" type="submit">Update password</button></form></div>`;
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
  read('roster', 'team_roster_players', 'source_player_id,jersey_number,name,position', PERMISSIONS.PLAYERS_VIEW);
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

async function loadAuthenticatedWorkspace(sessionUser = null) {
  if (activeStaff) return;
  if (workspaceTransitioning) return;
  workspaceTransitioning = true;
  try {
    const user = sessionUser || (await supabaseClient.auth.getSession()).data.session?.user;
    if (!user) {
      showLogin();
      return;
    }
    const [{ data: profile, error: profileError }, { data: memberships, error: membershipError }] = await Promise.all([
      supabaseClient.from('profiles').select('id,display_name').eq('id', user.id).single(),
      supabaseClient.from('team_memberships').select('team_id,role_id,status,teams(id,name,slug),roles(label)').eq('user_id', user.id).eq('status', 'active')
    ]);
    if (profileError || membershipError || !profile || !memberships?.length) {
      showLogin('Your account is authenticated, but no active Arctic Foxes team membership was found.');
      return;
    }
    authTeam = memberships.find(membership => membership.teams?.slug === 'arctic-foxes-12u-aa') || memberships[0];
    const { data: permissions, error: permissionError } = await supabaseClient.from('role_permissions').select('capability').eq('role_id', authTeam.role_id);
    if (permissionError) {
      showLogin('Your team membership loaded, but permissions could not be loaded.');
      return;
    }
    authUser = user;
    authCapabilities = permissions.map(permission => permission.capability);
    activeStaff = { id: user.id, name: profile.display_name, initials: profile.display_name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(), roleId: authTeam.role_id, role: authTeam.roles?.label || authTeam.role_id, capabilities: authCapabilities };
    document.querySelector('#teamStatus').textContent = `${authTeam.teams?.name || 'Team'} · ${activeStaff.role}`;
    await loadPhase1Data(authTeam.team_id);
    appShell.hidden = false;
    appShell.removeAttribute('aria-hidden');
    authScreen.hidden = true;
    authScreen.setAttribute('aria-hidden', 'true');
  } catch (error) {
    authUser = null;
    activeStaff = null;
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
  showLoading();
  loadAuthenticatedWorkspace().catch(() => {
    workspaceTransitioning = false;
    showLogin('Unable to restore your Supabase session.');
  });
}
