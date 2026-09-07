const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const accessSource = fs.readFileSync('web/workspace-access.js', 'utf8');
const organizationSource = fs.readFileSync('web/organization-context.js', 'utf8');
const entitlementsSource = fs.readFileSync('web/entitlements.js', 'utf8');
const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

function loadModule(source, globals = {}) {
  const context = { window: { sessionStorage: storage(), ...globals } };
  vm.runInNewContext(source, context);
  return context.window;
}

const workspaces = [
  {
    organization_id: 'north-hills',
    organization_name: 'North Hills Hockey',
    team_id: 'north-hills-jv',
    team_name: 'Junior Varsity',
    season_id: 'north-season',
    season_name: '2026–27',
    membership_status: 'active',
    role_id: 'head_coach',
    role_label: 'Head Coach',
    effective_capabilities: ['dashboard.view', 'schedule.view'],
    plan_id: 'FOUNDING',
    effective_features: ['dashboard', 'schedule'],
    authorized: true
  },
  {
    organization_id: 'arctic-foxes',
    organization_name: 'Arctic Foxes',
    team_id: 'arctic-2014',
    team_name: '2014 BY — 12U AA',
    season_id: 'arctic-season',
    season_name: '2026–27',
    membership_status: 'active',
    role_id: 'assistant_coach',
    role_label: 'Assistant Coach',
    effective_capabilities: ['dashboard.view'],
    plan_id: 'FOUNDING',
    effective_features: ['dashboard'],
    authorized: true
  }
];

test('authorized workspace loading filters unauthorized rows and resolves selected workspace', async () => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'list_authorized_workspaces') return { data: [...workspaces, { organization_id: 'hidden', team_id: 'hidden', authorized: false }], error: null };
      return { data: [workspaces[1]], error: null };
    }
  };
  const win = loadModule(accessSource);
  const manager = win.FoxesWorkspaceAccess.createWorkspaceAccess({ client, storage: storage() });
  assert.equal((await manager.loadAuthorizedWorkspaces()).length, 2);
  const selected = await manager.resolveWorkspace('arctic-foxes', 'arctic-2014', 'arctic-season');
  assert.equal(selected.role_label, 'Assistant Coach');
  assert.deepEqual(calls.map(call => call[0]), ['list_authorized_workspaces', 'resolve_workspace_access']);
  assert.equal(calls[1][1].target_team_id, 'arctic-2014');
});

test('organization context supports multi-org selection without exposing unrelated teams', () => {
  const win = loadModule(organizationSource);
  const manager = win.FoxesOrganizationContext.createOrganizationContext({ storage: storage() });
  manager.load(workspaces);
  assert.equal(manager.context.organizations.length, 2);
  manager.select('north-hills');
  assert.deepEqual(manager.teamsForSelectedOrganization(workspaces).map(item => item.team_id), ['north-hills-jv']);
  assert.throws(() => manager.select('unknown-org'), /not authorized/);
});

test('entitlements reflect resolved backend features and clear between workspaces', () => {
  const win = loadModule(entitlementsSource);
  const manager = win.FoxesEntitlements.createEntitlements();
  manager.setWorkspace(workspaces[0]);
  assert.equal(manager.getCurrentPlan(), 'FOUNDING');
  assert.equal(manager.isFeatureEnabled('schedule'), true);
  assert.equal(manager.isFeatureEnabled('film'), false);
  manager.clear();
  assert.equal(manager.getFeatureSet().size, 0);
});

test('Stage E wires server-resolved workspace state and tenant clearing into the app shell', () => {
  assert.match(appSource, /loadAuthorizedWorkspaces/);
  assert.match(appSource, /resolveWorkspace\(organizationId, teamId, seasonId\)/);
  assert.match(appSource, /clearTenantState/);
  assert.match(appSource, /entitlements\.setWorkspace/);
  assert.match(appSource, /workspaceAccessManager\.persistPreference/);
  assert.match(indexSource, /id="organizationSwitcher"/);
  assert.match(indexSource, /organization-context\.js/);
  assert.match(indexSource, /workspace-access\.js/);
  assert.match(indexSource, /entitlements\.js/);
});
