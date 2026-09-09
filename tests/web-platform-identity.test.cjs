const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const platformSource = fs.readFileSync('web/platform-access.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/007_platform_identity_and_roles.sql', 'utf8');
const permissionsSource = fs.readFileSync('web/permissions.js', 'utf8');

function loadModule(source, globals = {}) {
  const context = { window: { ...globals } };
  vm.runInNewContext(source, context);
  return context.window;
}

function clientWith({ roles = [], adminFlag = false, rolesError = null, adminError = null } = {}) {
  const calls = [];
  return {
    calls,
    from: table => {
      calls.push(['from', table]);
      return {
        select: columns => {
          calls.push(['select', columns]);
          return Promise.resolve({ data: roles, error: rolesError });
        }
      };
    },
    rpc: name => {
      calls.push(['rpc', name]);
      return Promise.resolve({ data: adminFlag, error: adminError });
    }
  };
}

test('platform admin resolves with zero team memberships and no client-side trust', async () => {
  const client = clientWith({
    roles: [{ role: 'platform_admin', status: 'active' }],
    adminFlag: true
  });
  const win = loadModule(platformSource);
  const manager = win.FoxesPlatformAccess.createPlatformAccess({ client });
  await manager.load();
  assert.equal(manager.context.isPlatformAdmin, true);
  assert.deepEqual(manager.context.roles, ['platform_admin']);
  assert.equal(manager.context.isFounder, false);
  assert.ok(client.calls.some(([method, target]) => method === 'rpc' && target === 'is_platform_admin'));
  assert.ok(!client.calls.some(([method, target]) => method === 'from' && target === 'team_memberships'));
});

test('founder counts as platform admin and suspended roles do not apply', async () => {
  const client = clientWith({
    roles: [
      { role: 'founder', status: 'active' },
      { role: 'platform_admin', status: 'suspended' }
    ],
    adminFlag: true
  });
  const win = loadModule(platformSource);
  const manager = win.FoxesPlatformAccess.createPlatformAccess({ client });
  await manager.load();
  assert.equal(manager.context.isFounder, true);
  assert.equal(manager.context.isPlatformAdmin, true);
  assert.deepEqual(manager.context.roles, ['founder']);
});

test('ordinary team users resolve to no platform access', async () => {
  const client = clientWith({ roles: [], adminFlag: false });
  const win = loadModule(platformSource);
  const manager = win.FoxesPlatformAccess.createPlatformAccess({ client });
  await manager.load();
  assert.equal(manager.context.isPlatformAdmin, false);
  assert.equal(manager.context.isFounder, false);
  assert.equal(manager.context.error, '');
});

test('platform resolution failure is captured without blocking or throwing', async () => {
  const client = clientWith({ rolesError: { message: 'relation does not exist' } });
  const win = loadModule(platformSource);
  const manager = win.FoxesPlatformAccess.createPlatformAccess({ client });
  const context = await manager.load();
  assert.equal(context.isPlatformAdmin, false);
  assert.match(context.error, /relation does not exist/);
  manager.clear();
  assert.equal(manager.context.error, '');
});

test('platform access module never reads storage, URLs, or client flags', () => {
  assert.doesNotMatch(platformSource, /localStorage|sessionStorage/);
  assert.doesNotMatch(platformSource, /URLSearchParams|location\./);
  assert.doesNotMatch(platformSource, /user_metadata|app_metadata/);
});

test('web shell loads the platform access module', () => {
  assert.match(indexSource, /platform-access\.js\?v=platform-identity-1/);
  assert.ok(indexSource.indexOf('platform-access.js') < indexSource.indexOf('app.js'));
});

test('web app resolves and clears platform access around the session lifecycle', () => {
  assert.match(appSource, /FoxesPlatformAccess\.createPlatformAccess/);
  assert.match(appSource, /platformAccessManager\.load\(\)/);
  assert.match(appSource, /platformAccessManager\.clear\(\)/);
});

test('platform roles migration is additive, global, and separate from team roles', () => {
  assert.match(migrationSource, /create table public\.platform_roles/);
  assert.match(migrationSource, /role in \('founder', 'platform_admin'\)/);
  assert.doesNotMatch(migrationSource, /insert into public\.roles/);
  assert.doesNotMatch(migrationSource, /references public\.teams/);
  assert.doesNotMatch(migrationSource, /\bdelete from\b/i);
  assert.doesNotMatch(migrationSource, /\bdrop table\b/i);
});

test('platform authorization helpers are database-backed security definer functions', () => {
  for (const fn of ['has_platform_role', 'is_platform_admin', 'is_platform_founder', 'is_org_member', 'has_org_role', 'is_org_owner']) {
    assert.match(migrationSource, new RegExp(`function public\\.${fn}\\(`));
  }
  assert.match(migrationSource, /is_platform_admin\(\)[\s\S]*security definer/);
  assert.match(migrationSource, /revoke all on function public\.is_platform_admin\(\) from public/);
  assert.match(migrationSource, /grant execute on function public\.is_platform_admin\(\) to authenticated/);
});

test('founder privileges can only be granted or changed by a founder', () => {
  assert.match(migrationSource, /platform_roles_insert_for_platform_admins[\s\S]*role = 'platform_admin' or public\.is_platform_founder\(\)/);
  assert.match(migrationSource, /platform_roles_delete_for_platform_admins[\s\S]*role = 'platform_admin' or public\.is_platform_founder\(\)/);
});

test('stage 1 multi-team tables gain org and team scoped row level security', () => {
  for (const table of ['organizations', 'organization_memberships', 'seasons', 'team_branding']) {
    assert.match(migrationSource, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migrationSource, /organizations_update_for_org_owners_or_platform_admins/);
  assert.match(migrationSource, /organization_memberships_delete_for_org_owners_platform_admins_or_self/);
  assert.match(migrationSource, /seasons_select_for_team_members_or_platform_admins/);
  assert.match(migrationSource, /team_branding_select_for_team_members_or_platform_admins/);
  assert.match(migrationSource, /teams_select_for_platform_admins/);
  assert.match(migrationSource, /revoke all on public\.platform_roles, public\.organizations,[\s\S]*from anon/);
});

test('organizations retain at least one active owner', () => {
  assert.match(migrationSource, /function public\.prevent_final_org_owner_loss\(\)/);
  assert.match(migrationSource, /function public\.prevent_final_org_owner_delete\(\)/);
  assert.match(migrationSource, /An organization must retain at least one active owner\./);
});

test('prototype team permissions remain team-scoped with no platform role leakage', () => {
  assert.doesNotMatch(permissionsSource, /founder|platform_admin/);
});
