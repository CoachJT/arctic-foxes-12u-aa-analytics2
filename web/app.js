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
let phase1Data = null;
let phase1DataError = '';
let phase2AData = null;
let phase2ADataError = '';
const teamContextManager = window.FoxesTeamContext.createTeamContext({ client: supabaseClient });
const seasonContextManager = window.FoxesSeasonContext.createSeasonContext({ client: supabaseClient });
const teamContext = teamContextManager.context;
const seasonContext = seasonContextManager.context;
applyDocumentBrand();
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const queryParams = new URLSearchParams(location.search);
const authCallbackPresent = ['access_token', 'refresh_token', 'type', 'code', 'error', 'error_code']
  .some(key => hashParams.has(key) || queryParams.has(key));
const recoveryCallbackPresent = hashParams.get('type') === 'recovery'
  || queryParams.get('type') === 'recovery';
const prototypeMode = !authCallbackPresent
  && location.hostname === 'localhost'
  && queryParams.get('prototype') === '1';

const viewNames = { command: 'Command Center', schedule: 'Schedule', stats: 'Team Stats', players: 'Player Profiles', games: 'Game Center', scouting: 'Scouting', reports: 'Coach Reports', development: 'Player Development', admin: 'Admin', settings: 'Settings' };
const roleViews = { command: PERMISSIONS.DASHBOARD_VIEW, schedule: PERMISSIONS.SCHEDULE_VIEW, stats: PERMISSIONS.STATS_VIEW, players: PERMISSIONS.PLAYERS_VIEW, games: PERMISSIONS.GAMES_VIEW, scouting: PERMISSIONS.SCOUTING_VIEW, reports: PERMISSIONS.REPORTS_VIEW, development: PERMISSIONS.PLAYERS_VIEW, admin: PERMISSIONS.ADMIN_USERS, settings: PERMISSIONS.DASHBOARD_VIEW };

function cardTitle(title, link = '') { return `<div class="card-title"><h2>${title}</h2>${link ? `<a href="#">${link} →</a>` : ''}</div>`; }
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
function schedule() { return shell('Schedule','Live schedule synced from the team Windows app.',`<section class="card">${cardTitle(`Team schedule · ${phase1Data?.schedule?.length || 0} entries`,'Supabase read-only')}<div class="schedule-list">${(phase1Data?.schedule || []).slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).map(game=>`<div class="schedule-item"><div class="schedule-date"><strong>${escapeHtml(new Date(`${game.date}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'2-digit'}).toUpperCase())}</strong>${escapeHtml(String(game.date).slice(0,4))}</div><div><h3>${escapeHtml(game.opponent)}</h3><p>${escapeHtml(game.home_away)} · ${escapeHtml(game.location || 'Location unavailable')}${game.time ? ` · ${escapeHtml(game.time)}` : ''}</p></div><span class="tag">${escapeHtml(game.game_type)}</span></div>`).join('') || '<div class="empty-view"><h2>No schedule entries</h2><p>No synced schedule entries are available for this team.</p></div>'}</div></section>`); }
function stats() { const edit = can(PERMISSIONS.STATS_EDIT_OFFICIAL, activeStaff); const record = phase1Record(); const teamStats = phase1Data?.teamStats || []; const totals = teamStats.reduce((sum, row) => ({ shots: sum.shots + phase1Number(row.shots_for), pp: sum.pp + phase1Number(row.power_play_success), ppChances: sum.ppChances + phase1Number(row.power_play_chances), foW: sum.foW + phase1Number(row.faceoff_wins), foL: sum.foL + phase1Number(row.faceoff_losses) }), { shots: 0, pp: 0, ppChances: 0, foW: 0, foL: 0 }); return shell('Team Stats','Read-only statistics from the synced team game data.',`<div class="grid stat-grid">${[['RECORD',`${record.wins}–${record.losses}–${record.ties}`,`${record.games_played} games`],['SHOTS / GAME',(totals.shots / Math.max(teamStats.length,1)).toFixed(1),'From team game stats'],['FACE-OFFS',`${((totals.foW / Math.max(totals.foW + totals.foL,1)) * 100).toFixed(1)}%`,'From team game stats'],['PLAYER-STAT ROWS',String(phase1Data?.playerStats?.length || 0),'Synced player-stat rows']].map(x=>`<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}</div><section class="card">${cardTitle('Season overview','Supabase read-only')}${edit ? '<span class="permission-lock">Official stat editing remains disabled in this web read-only phase.</span>' : '<span class="permission-lock">Statistics are read-only for this phase.</span>'}<div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th><th>Total</th><th>Average / rate</th></tr></thead><tbody>${[['Goals for',record.goals_for, (record.goals_for / Math.max(record.games_played,1)).toFixed(2)],['Goals against',record.goals_against,(record.goals_against / Math.max(record.games_played,1)).toFixed(2)],['Shots on goal',totals.shots,(totals.shots / Math.max(teamStats.length,1)).toFixed(1)],['Power-play successes',totals.pp,`${totals.ppChances ? ((totals.pp / totals.ppChances) * 100).toFixed(1) : '0.0'}%`],['Face-off wins',totals.foW,`${((totals.foW / Math.max(totals.foW + totals.foL,1)) * 100).toFixed(1)}%`]].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div></section>`); }
function players() { const totals = playerStatTotals(); return shell('Player Profiles','Live roster and basic player stats from Supabase.',`<section class="card">${cardTitle(`Roster · ${phase1Data?.roster?.length || 0} players`,'Supabase read-only')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Position</th><th>Games</th><th>Goals</th><th>Points</th><th>+ / −</th><th>Status</th></tr></thead><tbody>${(phase1Data?.roster || []).map(player=>{const stat=totals.get(player.source_player_id)||{}; return `<tr><td><div class="player-cell"><span class="player-photo">${escapeHtml(player.jersey_number)}</span><strong>${escapeHtml(player.name)}</strong></div></td><td class="role">${escapeHtml(player.position)}</td><td>${phase1Number(stat.games)}</td><td>${phase1Number(stat.goals)}</td><td>${phase1Number(stat.goals)+phase1Number(stat.assists)}</td><td class="trend-up">${phase1Number(stat.plus_minus)}</td><td><span class="tag">${can(PERMISSIONS.PLAYERS_EVALUATE, activeStaff) ? 'Evaluate' : 'View only'}</span></td></tr>`;}).join('') || '<tr><td colspan="7">No roster data is available.</td></tr>'}</tbody></table></div></section>`); }
function gameCenter() {
  const teamStats = new Map((phase1Data?.teamStats || []).map(row => [row.source_game_id, row]));
  const playerStats = new Map();
  (phase1Data?.playerStats || []).forEach(row => playerStats.set(row.source_game_id, (playerStats.get(row.source_game_id) || 0) + 1));
  const games = (phase1Data?.games || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const cards = games.map(game => {
    const stats = teamStats.get(game.source_game_id);
    const hasScore = stats && (stats.goals_for !== null || stats.goals_against !== null);
    const score = hasScore ? `${phase1Number(stats.goals_for)}–${phase1Number(stats.goals_against)}` : 'Score unavailable';
    const result = hasScore ? (stats.goals_for > stats.goals_against ? 'WIN' : stats.goals_for < stats.goals_against ? 'LOSS' : 'TIE') : 'NOT SCORED';
    return `<article class="card game-card"><div class="game-card-head"><div><span class="eyebrow">${escapeHtml(phase1Date(game.date))}</span><h2>${escapeHtml(game.opponent || 'Opponent unavailable')}</h2><p>${escapeHtml(game.period_length_min ? `${game.period_length_min}-minute periods` : 'Game details synced from Windows')}</p></div><span class="result ${result === 'WIN' ? 'win' : result === 'LOSS' ? 'loss' : ''}">${result}</span></div><div class="game-score">${escapeHtml(score)}</div><div class="game-card-meta"><span>${playerStats.get(game.source_game_id) || 0} player-stat rows</span><span>${stats ? `${phase1Number(stats.shots_for)} shots for` : 'Official team stats unavailable'}</span><span class="tag">Read only</span></div></article>`;
  }).join('');
  return shell('Game Center', 'Read-only game summaries from the selected team and season.', `<div class="callout"><strong>${games.length} games synced</strong><br>Game Center shows official cloud-backed summaries only. Detailed video, TOI, tracking, and local game workflows remain in the Windows app.</div><div class="game-center-grid">${cards || '<section class="card empty-view"><div class="empty-icon">▣</div><h2>No games available</h2><p>No completed games are synced for the selected team and season.</p></section>'}</div>`);
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
  return shell('Settings', 'Review the selected workspace context and access model.', `<div class="settings-grid"><section class="card settings-card"><div class="card-title"><h2>Workspace context</h2><span class="tag">Read only</span></div><dl class="settings-list"><div><dt>Platform</dt><dd>${escapeHtml(PLATFORM.name)}</dd></div><div><dt>Team</dt><dd>${escapeHtml(tenantName())}</dd></div><div><dt>Season</dt><dd>${escapeHtml(tenantSeasonName())}</dd></div><div><dt>Role</dt><dd>${escapeHtml(activeStaff?.role || 'Authenticated team member')}</dd></div></dl></section><section class="card settings-card"><div class="card-title"><h2>Data policy</h2><span class="tag">Supabase reads</span></div><p class="settings-copy">This browser workspace reads authorized team data through Supabase RLS. Local video, TOI, tracking, vault, backups, and device settings remain in the Windows app.</p><span class="permission-lock">${authCapabilities.length} database-provided capabilities loaded</span></section></div>`);
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
  list.innerHTML = invites.map(invite => `<div class="invite-row"><div><strong>${escapeHtml(invite.display_name || 'Pending staff member')}</strong><small>${escapeHtml(invite.email || 'Email hidden')}</small></div><span>${escapeHtml(inviteRoleLabel(invite.role_id))}</span><b class="invite-badge ${escapeHtml(invite.status)}">${escapeHtml(invite.status)}</b>${invite.status === 'invited' ? `<button class="btn resend-setup-button" type="button" data-user-id="${escapeHtml(invite.user_id)}">Resend setup link</button>` : ''}</div>`).join('');
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

async function resendSetupLink(event) {
  const button = event.currentTarget;
  const userId = button.dataset.userId;
  if (!userId || button.disabled) return;
  button.disabled = true;
  button.textContent = 'Sending…';
  inviteStatusMessage('Verifying the invited membership and sending a new setup link…');
  const { data, error } = await supabaseClient.functions.invoke(INVITE_FUNCTION, {
    body: { action: 'resend_setup', userId }
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
    const { data: profile, error: profileError } = await supabaseClient.from('profiles').select('id,display_name').eq('id', user.id).single();
    let membershipContext;
    try {
      membershipContext = await teamContextManager.load(user.id);
    } catch (error) {
      membershipContext = null;
      console.error('Could not load team memberships:', error);
    }
    const memberships = membershipContext?.memberships || [];
    const membershipError = membershipContext?.error;
    if (profileError || membershipError || !profile || !memberships.length) {
      showLogin('Your account is authenticated, but no active team membership was found.');
      return;
    }
    authUser = user;
    const selectedMembership = teamContext.selectedMembership;
    authTeam = selectedMembership;
    activeStaff = { id: user.id, name: profile.display_name, initials: profile.display_name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(), roleId: selectedMembership.role_id, role: selectedMembership.roles?.label || selectedMembership.role_id, capabilities: [] };
    await loadSelectedTeam();
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
