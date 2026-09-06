const { PERMISSIONS, STAFF, can } = window.FoxesPermissions;
const app = document.querySelector('#app');
const nav = document.querySelectorAll('.nav-item');
const authScreen = document.querySelector('#authScreen');
const appShell = document.querySelector('#appShell');
const supabaseClient = window.supabase.createClient(
  'https://yshbvrumzusmwlprfcnr.supabase.co',
  'sb_publishable_PFK2d1or62DYpk3VxarJwA_Anazyv7D'
);
let activeStaff = null;
let authUser = null;
let authTeam = null;
let authCapabilities = [];
let recoveryMode = false;
let workspaceTransitioning = false;
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const queryParams = new URLSearchParams(location.search);
const authCallbackPresent = ['access_token', 'refresh_token', 'type', 'code', 'error', 'error_code']
  .some(key => hashParams.has(key) || queryParams.has(key));
const recoveryCallbackPresent = hashParams.get('type') === 'recovery'
  || queryParams.get('type') === 'recovery';
const prototypeMode = !authCallbackPresent
  && location.hostname === 'localhost'
  && queryParams.get('prototype') === '1';

const sample = {
  leaders: [['17', 'Mia Chen', 'Forward · 14 GP', '18'], ['9', 'Sofia Park', 'Forward · 14 GP', '16'], ['31', 'Avery Brooks', 'Goalie · 9 GP', '91.4%'], ['4', 'Noah Williams', 'Defense · 14 GP', '+11']],
  recent: [['North Shore Storm', 'Jan 18 · Home', '4–2', 'W'], ['Riverside Ravens', 'Jan 11 · Away', '2–3', 'L'], ['Metro Blades', 'Jan 04 · Home', '5–1', 'W'], ['Pine Valley Jets', 'Dec 21 · Away', '3–2', 'W']]
};
const viewNames = { command: 'Command Center', schedule: 'Schedule', stats: 'Team Stats', players: 'Player Profiles', games: 'Game Center', scouting: 'Scouting', reports: 'Coach Reports', admin: 'Admin', settings: 'Settings' };
const roleViews = { command: PERMISSIONS.DASHBOARD_VIEW, schedule: PERMISSIONS.SCHEDULE_VIEW, stats: PERMISSIONS.STATS_VIEW, players: PERMISSIONS.PLAYERS_VIEW, games: PERMISSIONS.GAMES_VIEW, scouting: PERMISSIONS.SCOUTING_VIEW, reports: PERMISSIONS.REPORTS_VIEW, admin: PERMISSIONS.ADMIN_USERS, settings: PERMISSIONS.DASHBOARD_VIEW };

function cardTitle(title, link = '') { return `<div class="card-title"><h2>${title}</h2>${link ? `<a href="#">${link} →</a>` : ''}</div>`; }
function shell(title, subtitle, body) { return `<div class="page-head"><div><div class="eyebrow">Arctic Foxes · Live team workspace</div><h1>${title}</h1><p>${subtitle}</p></div></div>${body}`; }
function notice(text) { return `<div class="callout prototype-note">${text}</div>`; }
function leaders() { return sample.leaders.map(([n, name, meta, value]) => `<div class="leader"><span class="jersey">#${n}</span><div><strong>${name}</strong><small>${meta}</small></div><span class="leader-value">${value}</span></div>`).join(''); }
function recent() { return sample.recent.map(([team, date, score, result]) => `<div class="game-row"><div><strong>${team}</strong><small>${date}</small></div><span class="score">${score}</span><span class="result ${result === 'W' ? 'win' : 'loss'}">${result === 'W' ? 'WIN' : 'LOSS'}</span><span class="arrow">›</span></div>`).join(''); }

function command() {
  return shell('Good morning, Coach.', 'Here is the team picture for your next decision.', `<div class="grid hero-grid"><section class="card next-game">${cardTitle('NEXT GAME', 'Game prep')}<div class="game-top"><div class="opponent"><div class="opponent-mark">RV</div><div><p>Saturday · January 24, 2026</p><h2>Riverside Ravens</h2><p>Northstar Ice Arena · 10:30 AM</p></div></div><span class="home-pill">Home</span></div><div class="game-date"><strong>02 <span>days</span> · 14 <span>hours</span></strong><span>Game 15 of 24 · Regular season</span></div><div class="game-meta"><div>LAST MEETING<b>W 3–1</b></div><div>OPPONENT RECORD<b>8–5–1</b></div><div>PREP STATUS<b style="color:var(--gold)">In progress</b></div></div></section><section class="card record-card">${cardTitle('SEASON RECORD', 'View schedule')}<div class="record"><span class="record-number">10<span>–</span>3<span>–</span>1</span><div class="record-copy"><strong>2nd in Metro North</strong>4-game unbeaten streak<br>68% points percentage</div></div><div class="record-bars">${[1,1,1,1,1,1,1,1,1,1,0,0,1,1].map(x => `<i style="${x ? '' : 'background:var(--red)'}"></i>`).join('')}</div><div class="record-legend"><span>Oct 04</span><span>Last 14 games</span><span>Jan 18</span></div></section></div><div class="grid stat-grid">${[['GOALS FOR / GAME','3.86','↑ 0.42 vs last 5'],['GOALS AGAINST / GAME','2.14','↑ Best in division'],['POWER PLAY','24.6%','↑ 6.1% this month'],['TEAM EFFORT','8.4 / 10','↑ Trending up']].map(x => `<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}</div><div class="grid split"><section class="card">${cardTitle('TEAM TRENDS', 'Open analytics')}<div class="trend-chart">${[39,52,46,65,57,73,68,84,77,92].map((h,i) => `<div class="bar-col"><i style="height:${h}%"></i><b>${['O4','O11','N1','N8','N15','N22','D6','D13','J4','J18'][i]}</b></div>`).join('')}</div></section><section class="card">${cardTitle('TOP PLAYERS', 'All players')}${leaders()}</section></div><section class="card recent">${cardTitle('RECENT GAMES', 'Game Center')}${recent()}</section>`);
}
function schedule() { const games = [['JAN 24','Riverside Ravens','Home · Northstar Ice Arena · 10:30 AM','UP NEXT'],['JAN 31','Easton Eagles','Away · Easton Community Rink · 2:00 PM','SCHEDULED'],['FEB 07','Cedar Valley Huskies','Home · Northstar Ice Arena · 11:15 AM','SCHEDULED'],['FEB 14','Metro Blades','Away · Metroplex Ice Center · 4:30 PM','SCHEDULED']]; return shell('Schedule','Plan the weeks ahead and keep the bench aligned.',`<section class="card">${cardTitle('Team schedule','Prototype view')}<div class="schedule-list">${games.map(g=>`<div class="schedule-item"><div class="schedule-date"><strong>${g[0]}</strong>2026</div><div><h3>${g[1]}</h3><p>${g[2]}</p></div><span class="tag">${g[3]}</span></div>`).join('')}</div></section>`); }
function stats() { const edit = can(PERMISSIONS.STATS_EDIT_OFFICIAL, activeStaff); return shell('Team Stats','A quick view of the sample season profile.',`<div class="grid stat-grid">${[['RECORD','10–3–1','68% points'],['SHOTS / GAME','27.6','↑ 3.8 vs last month'],['FACE-OFFS','51.8%','↑ 2.4% this season'],['AVG. ICE TIME','13:42','Across 14 games']].map(x=>`<div class="card stat-card"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('')}</div><section class="card">${cardTitle('Season overview','Download CSV')}${edit ? '<button class="btn primary">Edit official stats</button>' : '<span class="permission-lock">Official stat editing restricted to Owner / Head Coach</span>'}<div class="table-wrap"><table class="data-table"><thead><tr><th>Metric</th><th>Total</th><th>Average / rate</th><th>Change</th></tr></thead><tbody>${[['Goals for','54','3.86','+0.42'],['Goals against','30','2.14','−0.31'],['Shots on goal','386','27.6','+3.8'],['Power play goals','14','24.6%','+6.1%'],['Penalty kill','31','82.4%','−1.2%']].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td class="trend-up">${r[3]}</td></tr>`).join('')}</tbody></table></div></section>`); }
function players() { const rows = [['17','Mia Chen','Forward','18','16','+8'],['9','Sofia Park','Forward','12','16','+9'],['4','Noah Williams','Defense','3','11','+11'],['22','Emma Rodriguez','Forward','9','12','+6'],['31','Avery Brooks','Goalie','—','—','—'],['6','Lucas Martin','Defense','2','7','+4']]; return shell('Player Profiles','Sample roster view for coaching conversations.',`<section class="card">${cardTitle('Roster · 14 players','Manage roster')}<div class="table-wrap"><table class="data-table"><thead><tr><th>Player</th><th>Position</th><th>Goals</th><th>Points</th><th>+ / −</th><th>Status</th></tr></thead><tbody>${rows.map(p=>`<tr><td><div class="player-cell"><span class="player-photo">${p[0]}</span><strong>${p[1]}</strong></div></td><td class="role">${p[2]}</td><td>${p[3]}</td><td>${p[4]}</td><td class="trend-up">${p[5]}</td><td><span class="tag">${can(PERMISSIONS.PLAYERS_EVALUATE, activeStaff) ? 'Evaluate' : 'View only'}</span></td></tr>`).join('')}</tbody></table></div></section>`); }
function admin() { const owner = can(PERMISSIONS.ADMIN_PERMISSIONS, activeStaff); return shell('Admin','Set up the people and access model for the team.',`${owner ? `<section class="card">${cardTitle('Accounts & permissions','Future audit log')}<div class="staff-grid"><article class="staff-card"><div class="staff-avatar">${activeStaff.initials}</div><div><h3>${activeStaff.name}</h3><p>${activeStaff.role}</p><span class="role-status">Authenticated team member</span></div></article></div><div class="permission-summary"><strong>Owner controls enabled</strong><span>${authCapabilities.length} database-provided capabilities</span></div></section>` : `<section class="card empty-view"><div class="empty-icon">⌁</div><h2>Admin controls are restricted</h2><p>Only the Owner / Head Coach can manage accounts and permissions. Your current role can continue using its assigned team workflows.</p></section>`}`); }
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
  app.innerHTML = view === 'command' ? command() : view === 'schedule' ? schedule() : view === 'stats' ? stats() : view === 'players' ? players() : view === 'admin' ? admin() : generic(view);
  document.querySelector('#viewCrumb').textContent = viewNames[view]; renderRoleSwitcher();
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
    render();
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
  appShell.hidden = false;
  render();
} else {
  showLoading();
  loadAuthenticatedWorkspace().catch(() => {
    workspaceTransitioning = false;
    showLogin('Unable to restore your Supabase session.');
  });
}
