const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const platformSource = fs.readFileSync('web/platform-access.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const migrationSource = fs.readFileSync('supabase/migrations/014_organization_branding_asset_pipeline.sql', 'utf8');
const permissionsSource = fs.readFileSync('web/permissions.js', 'utf8');

function loadModule(source, globals = {}) {
  const context = { window: { ...globals } };
  vm.runInNewContext(source, context);
  return context.window;
}

function clientWith({ adminFlag = false, founderFlag = false, adminError = null, founderError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: name => {
      calls.push(['rpc', name]);
      return Promise.resolve(name === 'is_platform_founder'
        ? { data: founderFlag, error: founderError }
        : { data: adminFlag, error: adminError });
    }
  };
}

test('platform admin resolves with zero team memberships and no client-side trust', async () => {
  const client = clientWith({
    adminFlag: true
  });
  const win = loadModule(platformSource);
  const manager = win.FoxesPlatformAccess.createPlatformAccess({ client });
  await manager.load();
  assert.equal(manager.context.isPlatformAdmin, true);
  assert.deepEqual(Array.from(manager.context.roles), ['platform_admin']);
  assert.equal(manager.context.isFounder, false);
  assert.ok(client.calls.some(([method, target]) => method === 'rpc' && target === 'is_platform_admin'));
  assert.ok(!client.calls.some(([method, target]) => method === 'from' && target === 'team_memberships'));
});

test('founder remains a database-backed specialization of production platform admin', async () => {
  const client = clientWith({ adminFlag: true, founderFlag: true });
  const win = loadModule(platformSource);
  const manager = win.FoxesPlatformAccess.createPlatformAccess({ client });
  await manager.load();
  assert.equal(manager.context.isFounder, true);
  assert.equal(manager.context.isPlatformAdmin, true);
  assert.deepEqual(Array.from(manager.context.roles), ['founder']);
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
  const client = clientWith({ adminError: { message: 'authorization unavailable' } });
  const win = loadModule(platformSource);
  const manager = win.FoxesPlatformAccess.createPlatformAccess({ client });
  const context = await manager.load();
  assert.equal(context.isPlatformAdmin, false);
  assert.match(context.error, /authorization unavailable/);
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

test('production platform admins remain global and separate from team roles', () => {
  assert.match(migrationSource, /create table public\.platform_admins/);
  assert.match(migrationSource, /user_id uuid primary key references auth\.users/);
  assert.doesNotMatch(migrationSource, /\bdelete from\b/i);
  assert.doesNotMatch(migrationSource, /\bdrop table\b/i);
});

test('platform authorization helpers are database-backed security definer functions', () => {
  assert.match(migrationSource, /function public\.is_platform_admin\(\)/);
  assert.match(migrationSource, /is_platform_admin\(\)[\s\S]*security definer/);
  assert.match(migrationSource, /revoke all on function public\.is_platform_admin\(\) from public/);
  assert.match(migrationSource, /grant execute on function public\.is_platform_admin\(\) to authenticated/);
});

test('platform access uses only the production authorization RPC', () => {
  assert.match(platformSource, /client\.rpc\('is_platform_admin'\)/);
  assert.match(platformSource, /client\.rpc\('is_platform_founder'\)/);
  assert.doesNotMatch(platformSource, /from\('platform_roles'\)/);
});

test('prototype team permissions remain team-scoped with no platform role leakage', () => {
  assert.doesNotMatch(permissionsSource, /founder|platform_admin/);
});
