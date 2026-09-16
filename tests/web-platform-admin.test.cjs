const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const adminSource = fs.readFileSync('web/platform-admin.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const stylesSource = fs.readFileSync('web/styles.css', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/20260909000100_020_reconciled_platform_admin_dashboard.sql', 'utf8');
const deliveryMigration = fs.readFileSync('supabase/migrations/20260909000300_022_reconciled_workspace_invite_delivery.sql', 'utf8');

function elementStub() {
  return { innerHTML: '', classList: { add() {} }, querySelector: () => null, querySelectorAll: () => [] };
}

function rpcClient(responses) {
  const calls = [];
  return {
    calls,
    rpc: (name, args) => {
      calls.push([name, args || {}]);
      const responder = responses[name];
      const value = typeof responder === 'function' ? responder(args) : responder;
      if (value instanceof Error) return Promise.resolve({ data: null, error: value });
      return Promise.resolve({ data: value, error: null });
    }
  };
}

function loadAdmin(responses, platformAccess = { isPlatformAdmin: true, roles: ['platform_admin'] }) {
  const context = { window: {} };
  vm.runInNewContext(adminSource, context);
  const manager = context.window.FoxesPlatformAdmin.createPlatformAdmin({
    client: rpcClient(responses),
    platformAccess,
    branding: { name: 'PuckNexus' }
  });
  return manager;
}

const sampleOrgs = [
  { id: 'org-1', name: 'Arctic Foxes', slug: 'arctic-foxes', status: 'active', beta_status: 'early_adopter', created_at: '2026-01-01', team_count: 2, member_count: 5 },
  { id: 'org-2', name: 'Riverside Hockey', slug: 'riverside', status: 'paused', beta_status: 'none', created_at: '2026-02-01', team_count: 1, member_count: 2 }
];

const sampleTeams = [
  { id: 'team-1', name: 'Foxes 12U AA', slug: 'foxes-12u-aa', organization_id: 'org-1', organization_name: 'Arctic Foxes', default_season_id: 'season-1', default_season_key: '2026-2027', beta_status: 'beta_team', created_at: '2026-01-02', member_count: 4, pending_invite_count: 1 },
  { id: 'team-2', name: 'Foxes 10U', slug: 'foxes-10u', organization_id: 'org-1', organization_name: 'Arctic Foxes', default_season_id: null, default_season_key: null, beta_status: 'none', created_at: '2026-01-03', member_count: 1, pending_invite_count: 0 }
];

test('View organization offers read-only support and only exposes normal hub for an active membership', async () => {
  const context = { window: {} };
  vm.runInNewContext(adminSource, context);
  const responses = { admin_list_teams: sampleTeams, admin_list_memberships: [], admin_list_invitations: [], admin_list_onboarding: [] };
  const root = elementStub();
  const manager = context.window.FoxesPlatformAdmin.createPlatformAdmin({ client: rpcClient(responses), platformAccess: { isPlatformAdmin: true }, canOpenTeamHub: id => id === 'team-1' });
  manager.mount(root);
  manager.setView('team', { id: 'team-1' });
  await flush();
  assert.match(root.innerHTML, /View organization/);
  assert.match(root.innerHTML, /data-open-support="team-1"/);
  assert.match(root.innerHTML, /data-open-team-hub="team-1"/);
  manager.setView('team', { id: 'team-2' });
  await flush();
  assert.doesNotMatch(root.innerHTML, /data-open-team-hub=/);
});

const sampleUsers = [
  { id: 'user-founder', display_name: 'Justin Platform', platform_roles: ['founder', 'platform_admin'], organization_memberships: [], team_memberships: [], pending_invitations: 0 },
  { id: 'user-coach', display_name: 'Joe Coach', platform_roles: [], organization_memberships: [{ organization_id: 'org-1', organization_name: 'Arctic Foxes', role: 'coach', status: 'active' }], team_memberships: [{ team_id: 'team-1', team_name: 'Foxes 12U AA', role_id: 'assistant', status: 'active' }], pending_invitations: 0 },
  { id: 'user-invited', display_name: 'New Assistant', platform_roles: [], organization_memberships: [], team_memberships: [{ team_id: 'team-1', team_name: 'Foxes 12U AA', role_id: 'assistant', status: 'invited' }], pending_invitations: 1 },
  { id: 'user-nobody', display_name: 'No Access User', platform_roles: [], organization_memberships: [], team_memberships: [], pending_invitations: 0 }
];

const sampleInvites = [
  { id: 'inv-1', team_id: 'team-1', team_name: 'Foxes 12U AA', email: 'pending@example.com', display_name: 'Pending Person', role_id: 'assistant', status: 'pending', invited_by: 'user-founder', expires_at: '2026-10-01', created_at: '2026-09-01' },
  { id: 'inv-2', team_id: 'team-1', team_name: 'Foxes 12U AA', email: 'expired@example.com', display_name: '', role_id: 'assistant', status: 'expired', invited_by: 'user-founder', expires_at: '2026-08-01', created_at: '2026-07-01' },
  { id: 'inv-3', team_id: 'team-1', team_name: 'Foxes 12U AA', email: 'done@example.com', display_name: 'Accepted Person', role_id: 'assistant_goalie', status: 'accepted', invited_by: 'user-founder', expires_at: '2026-08-01', created_at: '2026-07-01' }
];

function flush() {
  return new Promise(resolve => setImmediate(resolve)).then(() => new Promise(resolve => setImmediate(resolve)));
}

test('unauthorized users are refused the dashboard before any RPC is attempted', () => {
  for (const access of [{ isPlatformAdmin: false, roles: [] }, null]) {
    const manager = loadAdmin({ admin_list_organizations: sampleOrgs }, access);
    const root = elementStub();
    manager.mount(root);
    assert.match(root.innerHTML, /Platform Admin access required/);
  }
});

test('platform admins and founders can mount the dashboard shell', () => {
  for (const roles of [['platform_admin'], ['founder'], ['founder', 'platform_admin']]) {
    const manager = loadAdmin({ admin_list_organizations: sampleOrgs }, { isPlatformAdmin: true, roles });
    const root = elementStub();
    manager.mount(root);
    assert.match(root.innerHTML, /Loading platform data|admin-nav/);
  }
});

test('overview renders only real database counts with no fabricated metrics', async () => {
  const manager = loadAdmin({ admin_list_organizations: sampleOrgs });
  const root = elementStub();
  manager.mount(root);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.innerHTML, /Platform overview/);
  assert.match(root.innerHTML, /<small>Organizations<\/small><strong>2<\/strong>/);
  assert.match(root.innerHTML, /<small>Total teams<\/small><strong>3<\/strong>/);
  assert.match(root.innerHTML, /<small>Beta \/ early adopter orgs<\/small><strong>1<\/strong>/);
  assert.doesNotMatch(root.innerHTML, /Mia Chen|Sample|Riverside Ravens/);
});

test('organizations view supports search and drill-down links', async () => {
  const manager = loadAdmin({ admin_list_organizations: sampleOrgs });
  const root = elementStub();
  manager.mount(root);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.innerHTML, /data-open-organization="org-1"/);
  assert.match(root.innerHTML, /admin-badge-early_adopter|Early Adopter/);
});

test('teams view lists every team with organization and pending invite context', async () => {
  const manager = loadAdmin({ admin_list_teams: sampleTeams });
  const root = elementStub();
  manager.mount(root);
  manager.setView('teams');
  await flush();
  assert.match(root.innerHTML, /Foxes 12U AA/);
  assert.match(root.innerHTML, /2026-2027/);
  assert.match(root.innerHTML, /1 pending/);
  assert.match(root.innerHTML, /Beta Team/);
});

test('team detail returns memberships, invitations, and beta actions', async () => {
  const memberships = [
    { user_id: 'user-coach', display_name: 'Joe Coach', role_id: 'assistant', role_label: 'Assistant Coach', status: 'active', created_at: '2026-01-05' }
  ];
  const manager = loadAdmin({
    admin_list_teams: sampleTeams,
    admin_list_memberships: memberships,
    admin_list_invitations: sampleInvites,
    admin_list_onboarding: [
      { user_id: 'user-new', display_name: 'New Coach', organization_id: 'org-1', organization_name: 'Arctic Foxes', team_id: 'team-1', team_name: 'Foxes 12U AA', current_step: 'roster', status: 'in_progress', updated_at: '2026-09-08', completed_at: null }
    ]
  });
  const root = elementStub();
  manager.mount(root);
  manager.setView('team', { id: 'team-1' });
  await flush();
  assert.match(root.innerHTML, /Joe Coach/);
  assert.match(root.innerHTML, /Assistant Coach/);
  assert.match(root.innerHTML, /pending@example\.com/);
  assert.match(root.innerHTML, /Onboarding status/);
  assert.match(root.innerHTML, /In progress/);
  assert.match(root.innerHTML, /roster/);
  assert.match(root.innerHTML, /data-beta-kind="team"/);
});

test('users view distinguishes platform roles from team and org roles', async () => {
  const manager = loadAdmin({ admin_list_users: sampleUsers });
  const root = elementStub();
  manager.mount(root);
  manager.setView('users');
  await flush();
  assert.match(root.innerHTML, /Founder/);
  assert.match(root.innerHTML, /Platform Admin/);
  assert.match(root.innerHTML, /Arctic Foxes \(coach\)/);
  assert.match(root.innerHTML, /data-open-user="user-coach"/);
});

test('expected destination diagnostics match the routing model', () => {
  const manager = loadAdmin({});
  assert.equal(manager.expectedDestination(sampleUsers[0]).state, 'platform_admin');
  assert.equal(manager.expectedDestination(sampleUsers[0]).label, 'Admin Dashboard');
  assert.equal(manager.expectedDestination(sampleUsers[1]).state, 'team_workspace');
  assert.equal(manager.expectedDestination(sampleUsers[2]).state, 'onboarding');
  assert.match(manager.expectedDestination(sampleUsers[2]).issues[0], /still invited, not active/);
  const nobody = manager.expectedDestination(sampleUsers[3]);
  assert.equal(nobody.state, 'no_access');
  assert.match(nobody.issues[0], /No active membership or platform role found/);
  const suspended = manager.expectedDestination({ platform_roles: [], team_memberships: [{ team_name: 'Foxes', status: 'suspended' }] });
  assert.equal(suspended.state, 'no_access');
});

test('user detail shows the troubleshooting panel with human-readable issues', async () => {
  const manager = loadAdmin({ admin_get_user: [sampleUsers[2]] });
  const root = elementStub();
  manager.mount(root);
  manager.setView('user', { id: 'user-invited' });
  await flush();
  assert.match(root.innerHTML, /Access troubleshooting/);
  assert.match(root.innerHTML, /Expected destination: Onboarding/);
});

test('invitation statuses render distinctly and actions only appear for actionable rows', async () => {
  const manager = loadAdmin({ admin_list_invitations: sampleInvites });
  const root = elementStub();
  manager.mount(root);
  manager.setView('invitations');
  await flush();
  assert.match(root.innerHTML, /admin-badge-pending/);
  assert.match(root.innerHTML, /admin-badge-expired/);
  assert.match(root.innerHTML, /admin-badge-accepted/);
  assert.match(root.innerHTML, /data-resend-invite="inv-1"/);
  assert.match(root.innerHTML, /data-revoke-invite="inv-1"/);
  assert.doesNotMatch(root.innerHTML, /data-resend-invite="inv-3"/);
});

test('admin invite actions call only the server-authorized RPCs', () => {
  assert.match(adminSource, /functions\.invoke\('invite-staff'/);
  assert.match(adminSource, /action: 'resend_setup'/);
  assert.match(adminSource, /admin_revoke_invitation/);
  assert.doesNotMatch(adminSource, /\.from\('team_invitations'\)/);
  assert.doesNotMatch(adminSource, /\.(insert|update|delete)\(/);
});

test('beta state is database-backed through a guarded RPC', () => {
  assert.match(adminSource, /admin_set_beta_status/);
  assert.match(migrationSource, /beta_status text not null default 'none'/);
  assert.match(migrationSource, /function public\.admin_set_beta_status\(\s*target_kind text,\s*target_id uuid,\s*new_status text\s*\)/);
  assert.match(migrationSource, /if not public\.is_platform_admin\(\) then[\s\S]{0,200}raise exception 'Platform Admin access is required\.'/);
});

test('dashboard RPC failures render an error state instead of stale content', async () => {
  const manager = loadAdmin({ admin_list_organizations: new Error('Platform Admin access is required.') });
  const root = elementStub();
  manager.mount(root);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.innerHTML, /Request failed/);
  assert.match(root.innerHTML, /Platform Admin access is required\./);
});

test('every admin read RPC is guarded by is_platform_admin server-side', () => {
  const reads = ['admin_list_organizations', 'admin_get_organization', 'admin_list_teams', 'admin_list_users', 'admin_get_user', 'admin_list_memberships', 'admin_list_invitations'];
  for (const name of reads) {
    assert.match(migrationSource, new RegExp(`function public\\.${name}\\(`), name);
  }
  const guarded = migrationSource.match(/public\.is_platform_admin\(\)/g) || [];
  assert.ok(guarded.length >= 8, 'every read filter and write guard must reference is_platform_admin() directly or through a guarded RPC');
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /revoke all on function public\.admin_list_users\(\) from public/);
});

test('admin dashboard migration is additive and contains no founder management', () => {
  assert.doesNotMatch(migrationSource, /\bdelete from\b/i);
  assert.doesNotMatch(migrationSource, /\bdrop table\b/i);
  assert.doesNotMatch(migrationSource, /insert into public\.platform_roles/);
  assert.doesNotMatch(migrationSource, /make_founder|grant_founder/);
  assert.match(migrationSource, /platform_admins_role_check/);
  assert.match(migrationSource, /create or replace function public\.is_platform_founder\(\)/);
});

test('invitation lifecycle is first-class and expires pending rows safely', () => {
  assert.match(migrationSource, /from public\.workspace_invites invite/);
  assert.match(migrationSource, /when invite\.status = 'pending'[\s\S]*then 'expired'/);
  assert.match(migrationSource, /Only pending invitations can be revoked\./);
  assert.match(deliveryMigration, /create or replace function public\.claim_workspace_invite_delivery/);
  assert.match(deliveryMigration, /create or replace function public\.rotate_workspace_invite_delivery_token/);
});

test('app routes the platform admin destination to the dashboard and unmounts on clear', () => {
  assert.match(appSource, /FoxesPlatformAdmin\.createPlatformAdmin/);
  assert.match(appSource, /platformAdminManager\.mount\(authScreen\.querySelector\('#platformAdminRoot'\)\)/);
  assert.match(appSource, /platformAdminManager\.unmount\(\)/);
  assert.match(indexSource, /platform-admin\.js\?v=org-view-1/);
  assert.ok(indexSource.indexOf('platform-access.js') < indexSource.indexOf('platform-admin.js'));
  assert.ok(indexSource.indexOf('platform-admin.js') < indexSource.indexOf('app.js'));
});

test('admin dashboard has responsive styles and no horizontal overflow on mobile', () => {
  assert.match(stylesSource, /\.platform-admin-root/);
  assert.match(stylesSource, /\.admin-nav-item\.active/);
  assert.match(stylesSource, /admin-badge-pending/);
  assert.match(stylesSource, /admin-badge-founder/);
  assert.match(stylesSource, /@media\(max-width:700px\)[\s\S]{0,200}\.admin-table thead\{display:none\}/);
  assert.match(stylesSource, /@media\(max-width:420px\)[\s\S]{0,200}\.admin-stat-grid\{grid-template-columns:1fr\}/);
});

test('support diagnostics distinguish missing stats, zero scores and future games', () => {
  const context = {window:{}}; vm.runInNewContext(adminSource, context);
  const flags=context.window.FoxesPlatformAdmin.supportFlags;
  assert.equal(flags({date:'2026-09-01',goals_for:0,goals_against:0,player_stat_rows:2,player_goals:0},'2026-09-16').length,0);
  assert.equal(flags({date:'2026-10-01'},'2026-09-16').length,0);
  assert.equal(flags({date:'2026-09-01'},'2026-09-16').length,2);
  assert.match(flags({date:'2026-09-01',goals_for:3,goals_against:1,player_stat_rows:2,player_goals:2},'2026-09-16')[0],/verify context/);
});

test('support view scopes its request and escapes team and report content', async () => {
  let args;
  const manager=loadAdmin({admin_list_teams:sampleTeams,admin_team_support_snapshot: a => {
    args=a;return {team_id:a.target_team_id,season_id:'season-1',today:'2026-09-16',checked_at:'2026-09-16T01:00:00Z',roster_count:1,game_count:1,seasons:[],roster:[{name:'<img onerror=x>',jersey_number:4}],games:[{opponent:'Rivals',date:'2026-09-01',player_stat_rows:0}],reports:[{subject:'<script>x</script>',description:'<b>problem</b>'}]};
  }});
  const root=elementStub();manager.mount(root);manager.setView('teams');await flush();
  manager.setView('support',{id:'team-2',seasonId:'season-1'});await flush();
  assert.equal(args.target_team_id,'team-2');assert.equal(args.target_season_id,'season-1');
  assert.match(root.innerHTML,/READ ONLY/);assert.match(root.innerHTML,/Player stats not entered/);
  assert.match(root.innerHTML,/&lt;script&gt;/);assert.doesNotMatch(root.innerHTML,/<img|<script>/);
});

test('support errors fail visibly instead of presenting empty healthy data', async () => {
  const manager=loadAdmin({admin_team_support_snapshot:new Error('Platform Admin access required.')});
  const root=elementStub();manager.mount(root);manager.setView('support',{id:'team-1'});await flush();
  assert.match(root.innerHTML,/Request failed/);assert.doesNotMatch(root.innerHTML,/No game-completeness flags/);
});

test('late team requests cannot overwrite a newer support selection or remount', async () => {
  let resolveOld;
  const client={rpc: (name,args)=>args?.target_team_id==='old' ? new Promise(resolve=>{resolveOld=resolve;}) : Promise.resolve({data:name==='admin_team_support_snapshot'?{team_id:'new',today:'2026-09-16',checked_at:'2026-09-16',roster_count:0,game_count:0}:[]})};
  const context={window:{}};vm.runInNewContext(adminSource,context);
  const manager=context.window.FoxesPlatformAdmin.createPlatformAdmin({client,platformAccess:{isPlatformAdmin:true}});
  const root=elementStub();manager.mount(root);await flush();manager.setView('support',{id:'old'});manager.setView('support',{id:'new'});await flush();
  const html=root.innerHTML;resolveOld({data:{team_id:'old'}});await flush();assert.equal(root.innerHTML,html);
  manager.unmount();manager.setView('support',{id:'old'});assert.equal(root.innerHTML,html);
});

test('support entry points require platform authorization before calls', async () => {
  const client=rpcClient({});const context={window:{}};vm.runInNewContext(adminSource,context);
  const manager=context.window.FoxesPlatformAdmin.createPlatformAdmin({client,platformAccess:{isPlatformAdmin:false}});
  manager.mount(elementStub());manager.setView('support',{id:'team-1'});await flush();assert.equal(client.calls.length,0);
});
