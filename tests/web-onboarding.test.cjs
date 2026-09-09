const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const onboardingSource = fs.readFileSync('web/onboarding.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const stylesSource = fs.readFileSync('web/styles.css', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/20260909000200_021_reconciled_self_service_onboarding.sql', 'utf8');
const resolverSource = fs.readFileSync('web/destination-resolver.js', 'utf8');

function elementStub() {
  const stub = { innerHTML: '', classList: { add() {} } };
  stub.querySelector = () => null;
  stub.querySelectorAll = () => [];
  return stub;
}

function flush() {
  return new Promise(resolve => setImmediate(resolve)).then(() => new Promise(resolve => setImmediate(resolve)));
}

function makeClient({ progress, rosterRows = [], inviteRows = [], brandingRow = null, orgRow = null, teamRow = null } = {}) {
  const rpcCalls = [];
  const tables = {
    team_roster_players: rosterRows,
    team_branding: brandingRow,
    organizations: orgRow,
    teams: teamRow
  };
  return {
    rpcCalls,
    rpc: (name, args) => {
      rpcCalls.push([name, args || {}]);
      if (name === 'onboarding_ensure') return Promise.resolve({ data: typeof progress === 'function' ? progress() : progress, error: progress instanceof Error ? progress : null });
      if (name === 'onboarding_list_invites') return Promise.resolve({ data: inviteRows, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from: table => {
      const result = tables[table];
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: () => Promise.resolve({ data: result, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: result, error: null }).then(resolve, reject)
      };
      return chain;
    }
  };
}

function loadOnboarding(clientOptions, callbacks = {}) {
  const context = { window: {} };
  vm.runInNewContext(onboardingSource, context);
  return context.window.FoxesOnboarding.createOnboarding({
    client: makeClient(clientOptions),
    user: { id: 'user-new', email: 'new@example.com' },
    branding: { name: 'PuckNexus' },
    ...callbacks
  });
}

const freshProgress = {
  user_id: 'user-new', organization_id: null, team_id: null, season_id: null,
  current_step: 'organization', organization_complete: false, team_complete: false,
  season_complete: false, roster_complete: false, staff_complete: false,
  branding_complete: false, review_complete: false, completed_at: null
};

test('brand-new users start at the organization step with a clear progress indicator', async () => {
  const manager = loadOnboarding({ progress: { ...freshProgress } });
  const root = elementStub();
  manager.mount(root);
  await flush();
  assert.match(root.innerHTML, /onboarding-progress/);
  assert.match(root.innerHTML, /Create your organization/);
  assert.match(root.innerHTML, /li class=" current"><span><\/span>Organization/);
  assert.equal(manager.step, 'organization');
});

test('resume returns the user to their saved step instead of restarting', async () => {
  const manager = loadOnboarding({
    progress: { ...freshProgress, current_step: 'roster', team_id: 'team-1', organization_complete: true, team_complete: true, season_complete: true },
    rosterRows: [{ jersey_number: '7', name: 'Jane Smith', position: 'F' }],
    orgRow: { id: 'org-1', name: 'Arctic Foxes', slug: 'arctic-foxes', status: 'active' },
    teamRow: { id: 'team-1', name: 'Foxes 12U AA', slug: 'foxes-12u-aa' }
  });
  const root = elementStub();
  manager.mount(root);
  await flush();
  assert.equal(manager.step, 'roster');
  assert.match(root.innerHTML, /Build your roster/);
  assert.match(root.innerHTML, /Jane Smith/);
  assert.match(root.innerHTML, /1 players? added/);
});

test('roster step offers both manual add and CSV import with visible results', async () => {
  const manager = loadOnboarding({
    progress: { ...freshProgress, current_step: 'roster', team_id: 'team-1', organization_complete: true, team_complete: true, season_complete: true },
    rosterRows: []
  });
  const root = elementStub();
  manager.mount(root);
  await flush();
  assert.match(root.innerHTML, /id="obAddPlayer"/);
  assert.match(root.innerHTML, /id="obImport"/);
  assert.match(root.innerHTML, /No players yet/);
  assert.match(root.innerHTML, /data-mark-step="roster"[^>]*disabled/);
});

test('staff step uses the first-class invitation lifecycle and is skippable', async () => {
  const manager = loadOnboarding({
    progress: { ...freshProgress, current_step: 'staff', team_id: 'team-1', organization_complete: true, team_complete: true, season_complete: true, roster_complete: true },
    inviteRows: [{ id: 'inv-1', email: 'coach@example.com', display_name: 'Joe', role_id: 'assistant', status: 'pending', expires_at: '2026-09-22' }]
  });
  const root = elementStub();
  manager.mount(root);
  await flush();
  assert.match(root.innerHTML, /coach@example\.com/);
  assert.match(root.innerHTML, />pending</);
  assert.match(root.innerHTML, /Continue/);
});

test('review step shows required statuses and disables finish until required steps are complete', async () => {
  const incomplete = loadOnboarding({
    progress: { ...freshProgress, current_step: 'review', team_id: 'team-1', organization_complete: true, team_complete: true, season_complete: true },
    rosterRows: [],
    orgRow: { id: 'org-1', name: 'Arctic Foxes' },
    teamRow: { id: 'team-1', name: 'Foxes 12U AA' }
  });
  const root = elementStub();
  incomplete.mount(root);
  await flush();
  assert.match(root.innerHTML, /Review your setup/);
  assert.match(root.innerHTML, /Needs attention/);
  assert.match(root.innerHTML, /id="obFinish"[^>]*disabled/);

  const complete = loadOnboarding({
    progress: { ...freshProgress, current_step: 'review', team_id: 'team-1', organization_complete: true, team_complete: true, season_complete: true, roster_complete: true },
    rosterRows: [{ jersey_number: '7', name: 'Jane Smith', position: 'F' }],
    orgRow: { id: 'org-1', name: 'Arctic Foxes' },
    teamRow: { id: 'team-1', name: 'Foxes 12U AA' }
  });
  const root2 = elementStub();
  complete.mount(root2);
  await flush();
  assert.match(root2.innerHTML, /FINISH SETUP/);
  assert.doesNotMatch(root2.innerHTML, /id="obFinish"[^>]*disabled/);
});

test('finish setup calls the server-side completion exactly once per click', async () => {
  const completed = { ...freshProgress, completed_at: '2026-09-08T00:00:00Z', current_step: 'complete', team_id: 'team-1' };
  let progressState = { ...freshProgress, current_step: 'review', team_id: 'team-1', organization_complete: true, team_complete: true, season_complete: true, roster_complete: true };
  let completedCalls = 0;
  const context = { window: {} };
  vm.runInNewContext(onboardingSource, context);
  const client = makeClient({
    progress: () => progressState,
    rosterRows: [{ jersey_number: '7', name: 'Jane Smith', position: 'F' }],
    orgRow: { id: 'org-1', name: 'Arctic Foxes' },
    teamRow: { id: 'team-1', name: 'Foxes 12U AA' }
  });
  const baseRpc = client.rpc;
  client.rpc = (name, args) => {
    if (name === 'onboarding_complete') {
      completedCalls += 1;
      progressState = completed;
    }
    return baseRpc(name, args);
  };
  const clickHandlers = {};
  const finishButton = { addEventListener: (event, handler) => { clickHandlers[event] = handler; } };
  const root = elementStub();
  root.querySelector = selector => (selector === '#obFinish' ? finishButton : null);
  let finishedWith = null;
  const manager = context.window.FoxesOnboarding.createOnboarding({
    client,
    user: { id: 'user-new', email: 'new@example.com' },
    branding: { name: 'PuckNexus' },
    onComplete: teamId => { finishedWith = teamId; }
  });
  manager.mount(root);
  await flush();
  assert.match(root.innerHTML, /FINISH SETUP/);
  assert.equal(typeof clickHandlers.click, 'function');
  clickHandlers.click();
  await flush();
  assert.equal(completedCalls, 1);
  assert.equal(finishedWith, 'team-1');
});

test('onboarding RPC failures render actionable errors without losing progress', async () => {
  const failing = { ...freshProgress };
  const context = { window: {} };
  vm.runInNewContext(onboardingSource, context);
  const client = makeClient({ progress: failing });
  client.rpc = name => name === 'onboarding_ensure'
    ? Promise.resolve({ data: failing, error: null })
    : Promise.resolve({ data: null, error: { message: 'Jersey number 7 is already assigned on this team.' } });
  const manager = context.window.FoxesOnboarding.createOnboarding({
    client,
    user: { id: 'user-new', email: 'new@example.com' },
    branding: { name: 'PuckNexus' }
  });
  const root = elementStub();
  manager.mount(root);
  await flush();
  assert.equal(manager.progress.current_step, 'organization');
});

test('onboarding module never trusts browser storage for progress', () => {
  assert.doesNotMatch(onboardingSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(onboardingSource, /URLSearchParams|location\./);
  assert.match(onboardingSource, /onboarding_ensure/);
});

test('onboarding migration is additive, user-scoped, and RLS protected', () => {
  assert.match(migrationSource, /create table public\.onboarding_progress/);
  assert.match(migrationSource, /user_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(migrationSource, /alter table public\.onboarding_progress enable row level security/);
  assert.match(migrationSource, /onboarding_progress_select_self/);
  assert.match(migrationSource, /grant select on public\.onboarding_progress to authenticated/);
  assert.doesNotMatch(migrationSource, /grant [^;]*insert[^;]*on public\.onboarding_progress to authenticated/);
  assert.match(migrationSource, /revoke all on public\.onboarding_progress from public, anon, authenticated/);
  assert.doesNotMatch(migrationSource, /\bdelete from\b/i);
  assert.doesNotMatch(migrationSource, /\bdrop table\b/i);
});

test('creation RPCs assign ownership server-side and are idempotent on retry', () => {
  assert.match(migrationSource, /function public\.onboarding_create_organization/);
  assert.match(migrationSource, /new_organization\.id,\s*caller_id,\s*'org_owner',\s*'active'/);
  assert.match(migrationSource, /An organization was already created for this onboarding\./);
  assert.match(migrationSource, /function public\.onboarding_create_team/);
  assert.match(migrationSource, /values \(new_team\.id, caller_id, 'owner', 'active', caller_id\)/);
  assert.match(migrationSource, /A team was already created for this onboarding\./);
  assert.match(migrationSource, /function public\.onboarding_create_season/);
  assert.match(migrationSource, /on conflict \(team_id, season_key\) do update/);
  assert.match(migrationSource, /set default_season_id = new_season\.id/);
  assert.match(migrationSource, /insert into public\.onboarding_progress \(user_id\)[\s\S]{0,200}on conflict \(user_id\) do nothing/);
  assert.doesNotMatch(migrationSource, /values \(organization_id, \(select auth\.uid/);
  assert.doesNotMatch(migrationSource, /values \(team_id, \(select auth\.uid/);
});

test('roster, staff, and branding RPCs validate input and scope to the onboarding team', () => {
  assert.match(migrationSource, /Jersey number % is already assigned to an active player on this team\./);
  assert.match(migrationSource, /Position must be F, D, or G\./);
  assert.doesNotMatch(migrationSource, /onboarding_invite_staff/);
  assert.match(migrationSource, /function public\.onboarding_list_invites\(\)/);
  assert.match(onboardingSource, /functions\.invoke\('invite-staff'/);
  assert.match(migrationSource, /Colors must be hex values like #d71920\./);
  assert.match(migrationSource, /update public\.team_branding/);
});

test('completion validates required steps and writes completed_at exactly once', () => {
  assert.match(migrationSource, /function public\.onboarding_complete\(\)/);
  assert.match(migrationSource, /Organization, team, and season setup must be complete\./);
  assert.match(migrationSource, /Add at least one active roster player before finishing setup\./);
  assert.match(migrationSource, /where user_id = caller_id/);
  assert.match(migrationSource, /already_complete/);
});

test('existing configured users have no progress row and bypass onboarding', () => {
  const context = { window: {} };
  vm.runInNewContext(resolverSource, context);
  const { DESTINATIONS, resolveDestination } = context.window.FoxesDestinationResolver;
  const configured = resolveDestination({
    user: { id: 'user-legacy' },
    platformAccess: { isPlatformAdmin: false, roles: [] },
    memberships: [{ team_id: 'team-1', status: 'active' }],
    pendingMemberships: [],
    onboardingProgress: null
  });
  assert.equal(configured.state, DESTINATIONS.TEAM_WORKSPACE);
  const incomplete = resolveDestination({
    user: { id: 'user-new' },
    platformAccess: { isPlatformAdmin: false, roles: [] },
    memberships: [{ team_id: 'team-1', status: 'active' }],
    pendingMemberships: [],
    onboardingProgress: { user_id: 'user-new', current_step: 'team', completed_at: null }
  });
  assert.equal(incomplete.state, DESTINATIONS.ONBOARDING);
});

test('admin dashboard surfaces real onboarding status per team', () => {
  const adminSource = fs.readFileSync('web/platform-admin.js', 'utf8');
  assert.match(adminSource, /admin_list_onboarding/);
  assert.match(adminSource, /Onboarding status/);
  assert.match(adminSource, /In progress/);
  assert.match(adminSource, /existing configured teams are not in onboarding/);
  assert.match(migrationSource, /function public\.admin_list_onboarding\(\)/);
  assert.match(migrationSource, /when progress\.completed_at is not null then 'completed'/);
  assert.match(migrationSource, /when progress\.organization_id is null and progress\.team_id is null then 'not_started'/);
  assert.match(migrationSource, /and public\.is_platform_admin\(\)/);
});

test('app wiring loads the wizard, passes progress to the resolver, and completes into the team workspace', () => {
  assert.match(indexSource, /onboarding\.js\?v=stage5-onboarding-1/);
  assert.ok(indexSource.indexOf('onboarding.js') < indexSource.indexOf('app.js'));
  assert.match(appSource, /FoxesOnboarding\.createOnboarding/);
  assert.match(appSource, /from\('onboarding_progress'\)/);
  assert.match(appSource, /onboardingProgress: onboardingProgress \|\| null/);
  assert.match(appSource, /onComplete: \(\) =>/);
  assert.match(appSource, /loadAuthenticatedWorkspace\(user\)/);
  assert.match(appSource, /onboardingManager\?\.unmount\(\)/);
});

test('onboarding is mobile-friendly with stacked layouts on small screens', () => {
  assert.match(stylesSource, /\.onboarding-progress li\.current/);
  assert.match(stylesSource, /@media\(max-width:700px\)[\s\S]{0,300}\.onboarding-inline,\.onboarding-staff\{grid-template-columns:1fr\}/);
  assert.match(stylesSource, /@media\(max-width:420px\)[\s\S]{0,300}\.onboarding-actions\{flex-direction:column/);
});
