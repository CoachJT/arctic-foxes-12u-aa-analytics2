const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const resolverSource = fs.readFileSync('web/destination-resolver.js', 'utf8');
const teamSource = fs.readFileSync('web/team-context.js', 'utf8');
const seasonSource = fs.readFileSync('web/season-context.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function query(result) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return chain;
}

function loadModule(source, globals = {}) {
  const context = {
    window: {
      sessionStorage: storage(),
      document: { documentElement: { style: { setProperty() {} } } },
      ...globals
    }
  };
  vm.runInNewContext(source, context);
  return context.window;
}

function resolver() {
  return loadModule(resolverSource).FoxesDestinationResolver;
}

const coach = { id: 'user-coach', email: 'joe@example.com' };

test('signed-out visitors resolve to sign in and never a workspace', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  assert.equal(resolveDestination({}).state, DESTINATIONS.SIGNED_OUT);
  assert.equal(resolveDestination({ user: null, platformAccess: { isPlatformAdmin: true }, memberships: [{}] }).state, DESTINATIONS.SIGNED_OUT);
});

test('founder and platform admin resolve to the admin destination with zero team memberships', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  for (const access of [
    { isPlatformAdmin: true, roles: ['platform_admin'] },
    { isPlatformAdmin: true, roles: ['founder', 'platform_admin'] }
  ]) {
    const destination = resolveDestination({ user: coach, platformAccess: access, memberships: [], pendingMemberships: [] });
    assert.equal(destination.state, DESTINATIONS.PLATFORM_ADMIN);
    assert.deepEqual(destination.memberships, []);
  }
});

test('platform admin destination wins even when team memberships exist', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  const memberships = [{ team_id: 'team-a', status: 'active' }];
  const destination = resolveDestination({ user: coach, platformAccess: { isPlatformAdmin: true, roles: ['platform_admin'] }, memberships, pendingMemberships: [] });
  assert.equal(destination.state, DESTINATIONS.PLATFORM_ADMIN);
  assert.equal(destination.memberships.length, 1);
});

test('coach and team owner resolve to the team workspace, never platform admin', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  const memberships = [
    { team_id: 'team-a', role_id: 'assistant', status: 'active' },
    { team_id: 'team-a', role_id: 'owner', status: 'active' }
  ];
  for (const membership of memberships) {
    const destination = resolveDestination({ user: coach, platformAccess: { isPlatformAdmin: false, roles: [] }, memberships: [membership], pendingMemberships: [] });
    assert.equal(destination.state, DESTINATIONS.TEAM_WORKSPACE);
  }
});

test('invited-only accounts without progress still reach onboarding; active members with progress bypass team workspace', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  const invited = resolveDestination({
    user: coach,
    platformAccess: { isPlatformAdmin: false, roles: [] },
    memberships: [],
    pendingMemberships: [{ team_id: 'team-a', status: 'invited', teams: { name: 'Arctic Foxes' } }],
    onboardingProgress: null
  });
  assert.equal(invited.state, DESTINATIONS.ONBOARDING);
  const configured = resolveDestination({
    user: coach,
    platformAccess: { isPlatformAdmin: false, roles: [] },
    memberships: [{ team_id: 'team-a', status: 'active' }],
    pendingMemberships: [],
    onboardingProgress: null
  });
  assert.equal(configured.state, DESTINATIONS.TEAM_WORKSPACE);
});

test('an incomplete onboarding progress row routes to onboarding even with an active membership', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  const destination = resolveDestination({
    user: coach,
    platformAccess: { isPlatformAdmin: false, roles: [] },
    memberships: [{ team_id: 'team-a', status: 'active' }],
    pendingMemberships: [],
    onboardingProgress: { user_id: 'user-coach', current_step: 'roster', completed_at: null }
  });
  assert.equal(destination.state, DESTINATIONS.ONBOARDING);
  assert.equal(destination.progress.current_step, 'roster');
});

test('a completed onboarding progress row never routes back to onboarding', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  const destination = resolveDestination({
    user: coach,
    platformAccess: { isPlatformAdmin: false, roles: [] },
    memberships: [{ team_id: 'team-a', status: 'active' }],
    pendingMemberships: [],
    onboardingProgress: { user_id: 'user-coach', current_step: 'complete', completed_at: '2026-09-08T00:00:00Z' }
  });
  assert.equal(destination.state, DESTINATIONS.TEAM_WORKSPACE);
});

test('suspended memberships fail closed to no access', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  const destination = resolveDestination({
    user: coach,
    platformAccess: { isPlatformAdmin: false, roles: [] },
    memberships: [{ team_id: 'team-a', status: 'suspended' }],
    pendingMemberships: []
  });
  assert.equal(destination.state, DESTINATIONS.NO_ACCESS);
});

test('accounts with nothing resolve to no access, not arbitrary team content', () => {
  const { DESTINATIONS, resolveDestination } = resolver();
  assert.equal(resolveDestination({ user: coach, platformAccess: { isPlatformAdmin: false, roles: [] }, memberships: [], pendingMemberships: [] }).state, DESTINATIONS.NO_ACCESS);
});

test('resolver consumes only server-resolved state', () => {
  assert.doesNotMatch(resolverSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(resolverSource, /location\.|URLSearchParams/);
  assert.doesNotMatch(resolverSource, /user_metadata|app_metadata/);
});

test('a remembered team from a previous account is rejected before use', async () => {
  const memberships = [
    { team_id: 'team-a', role_id: 'assistant', status: 'active', teams: { id: 'team-a', name: 'Team A', slug: 'team-a' }, roles: { label: 'Assistant' } }
  ];
  const client = { from: () => query({ data: memberships, error: null }) };
  const store = storage({ 'foxes-selected-team-id': 'team-unrelated-previous-account' });
  const win = loadModule(teamSource);
  const manager = win.FoxesTeamContext.createTeamContext({ client, storage: store });
  await manager.load('user-joe');
  assert.equal(manager.context.selectedTeamId, 'team-a');
  assert.equal(store.getItem('foxes-selected-team-id'), 'team-a');
  assert.throws(() => manager.select('team-unrelated-previous-account'), /not an active membership/);
});

test('sign-out clearing empties memberships and removes the remembered team', async () => {
  const memberships = [
    { team_id: 'team-a', role_id: 'owner', status: 'active', teams: { id: 'team-a', name: 'Team A', slug: 'team-a' }, roles: { label: 'Owner' } }
  ];
  const client = { from: () => query({ data: memberships, error: null }) };
  const store = storage();
  const win = loadModule(teamSource);
  const manager = win.FoxesTeamContext.createTeamContext({ client, storage: store });
  await manager.load('user-1');
  manager.clearSelection();
  assert.equal(manager.context.memberships.length, 0);
  assert.equal(manager.context.pendingMemberships.length, 0);
  assert.equal(manager.context.selectedTeamId, '');
  assert.equal(store.getItem('foxes-selected-team-id'), null);
});

test('season context clearing removes the remembered season and restores fallback branding', async () => {
  const seasons = [{ id: 'season-1', team_id: 'team-a', name: '2026–2027 Season', season_key: '2026-2027', status: 'active' }];
  const branding = { team_id: 'team-a', primary_color: '#123456' };
  const client = {
    from: table => query(table === 'seasons' ? { data: seasons, error: null } : { data: branding, error: null })
  };
  const store = storage();
  const win = loadModule(seasonSource);
  const manager = win.FoxesSeasonContext.createSeasonContext({ client, storage: store });
  await manager.load('team-a');
  assert.equal(manager.context.branding.primary_color, '#123456');
  manager.clear();
  assert.equal(manager.context.seasons.length, 0);
  assert.equal(manager.context.selectedSeason, null);
  assert.equal(store.getItem('foxes-selected-season-id'), null);
  assert.equal(manager.context.branding.primary_color, '#d71920');
});

test('web shell loads the destination resolver before the app', () => {
  assert.match(indexSource, /destination-resolver\.js\?v=stage3-routing-1/);
  assert.ok(indexSource.indexOf('destination-resolver.js') < indexSource.indexOf('app.js'));
});

test('app bootstrap resolves session, platform access, and memberships before one destination decision', () => {
  assert.match(appSource, /FoxesDestinationResolver/);
  assert.match(appSource, /resolveDestination\(\{[\s\S]*user,[\s\S]*platformAccess,[\s\S]*memberships/);
  assert.match(appSource, /currentDestination = destination\.state/);
  const bootstrap = appSource.indexOf('async function loadAuthenticatedWorkspace');
  assert.ok(appSource.indexOf('platformAccessManager.load()', bootstrap) < appSource.indexOf('resolveDestination', bootstrap));
  assert.ok(appSource.indexOf('teamContextManager.load', bootstrap) < appSource.indexOf('resolveDestination', bootstrap));
});

test('every resolver destination has a dedicated safe UI state', () => {
  for (const state of ['DESTINATIONS.PLATFORM_ADMIN', 'DESTINATIONS.ONBOARDING', 'DESTINATIONS.NO_ACCESS']) {
    assert.ok(appSource.includes(`destination.state === ${state}`), state);
  }
  assert.match(appSource, /function showPlatformLanding\(/);
  assert.match(appSource, /function showOnboarding\(/);
  assert.match(appSource, /function showNoAccess\(/);
  assert.match(appSource, /<h1>Admin Dashboard<\/h1>/);
  assert.match(appSource, /FoxesOnboarding\.createOnboarding/);
  assert.match(appSource, /No active team access/);
});

test('sign out clears platform, team, season, and user state in one path', () => {
  assert.match(appSource, /function clearWorkspaceState\(\)[\s\S]*platformAccessManager\.clear\(\)[\s\S]*teamContextManager\.clearSelection\(\)[\s\S]*seasonContextManager\.clear\(\)/);
  const signOutBody = appSource.slice(appSource.indexOf('async function signOut'));
  assert.match(signOutBody, /intentionalSignOut = true/);
  assert.match(signOutBody, /supabaseClient\.auth\.signOut\(\)/);
  assert.match(signOutBody, /clearWorkspaceState\(\)/);
  assert.match(signOutBody, /showLogin\(\)/);
});

test('auth-state listener handles sign-in, sign-out, refresh, and user updates distinctly', () => {
  assert.match(appSource, /TOKEN_REFRESHED'\) return/);
  assert.match(appSource, /USER_UPDATED/);
  assert.match(appSource, /SIGNED_OUT/);
  assert.match(appSource, /session\.user\.id !== authUser\.id/);
  assert.match(appSource, /Your session has expired\. Please sign in again\./);
});

test('destinations are never derived from URL parameters or client flags', () => {
  assert.doesNotMatch(appSource, /queryParams\.get\('(view|destination|route|admin|onboarding)'\)/);
  assert.match(appSource, /\['localhost', '127\.0\.0\.1', '::1'\]\.includes\(location\.hostname\)/);
});

test('protected team data stays behind capability checks and the shell stays hidden until authorized', () => {
  assert.match(appSource, /admin: PERMISSIONS\.ADMIN_USERS/);
  assert.match(appSource, /if \(!can\(roleViews\[view\], activeStaff\)\) view = 'command'/);
  assert.match(indexSource, /<div class="app-shell" id="appShell" hidden>/);
  assert.match(indexSource, /<div class="auth-screen" id="authScreen" hidden><\/div>/);
});

test('no service worker or offline cache can serve stale protected content', () => {
  assert.doesNotMatch(indexSource, /serviceWorker/);
  assert.doesNotMatch(appSource, /serviceWorker|caches\.open/);
});
