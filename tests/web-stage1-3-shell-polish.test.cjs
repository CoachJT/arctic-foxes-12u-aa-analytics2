const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');
const styles = fs.readFileSync('web/styles.css', 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name} to exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract function ${name}`);
}

test('Stage 1.3 separates explicit platform authorization from team management and FOUNDING', () => {
  const source = `
    let currentWorkspace = { authorized: true, plan_id: 'FOUNDING' };
    let authCapabilities = [];
    ${extractFunction(app, 'hasPlatformAdminAuthorization')}
    this.normalCoach = hasPlatformAdminAuthorization();
    authCapabilities = ['admin.users'];
    this.teamAdmin = hasPlatformAdminAuthorization();
    authCapabilities = ['platform.admin'];
    this.platformAdmin = hasPlatformAdminAuthorization();
  `;
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(context.normalCoach, false);
  assert.equal(context.teamAdmin, false);
  assert.equal(context.platformAdmin, true);
  assert.match(app, /management: PERMISSIONS\.ADMIN_USERS/);
  assert.match(app, /management: 'admin'/);
  assert.match(app, /if \(view === 'platform-admin'\) return hasPlatformAdminAuthorization\(\)/);
  assert.doesNotMatch(extractFunction(app, 'hasPlatformAdminAuthorization'), /plan_id|FOUNDING/);
});

test('Stage 1.3 renders an accessible, consistent SVG navigation system', () => {
  const expectedIcons = ['home', 'team', 'calendar', 'game', 'players', 'stats', 'film', 'scouting', 'reports', 'development', 'tools', 'management', 'support', 'settings', 'platform'];
  for (const icon of expectedIcons) {
    assert.match(index, new RegExp(`id="icon-${icon}"`));
    assert.match(index, new RegExp(`href="#icon-${icon}"`));
  }
  assert.match(index, /aria-label="Primary navigation"/);
  assert.match(index, /Platform Admin/);
  assert.doesNotMatch(index, /data-view="admin"/);
  assert.match(styles, /\.nav-icon\{/);
  assert.match(styles, /\.nav-item\.active \.nav-icon\{color:var\(--brand-accent/);
});

test('Stage 1.3 shell identity is workspace-driven and uses a safe fallback', () => {
  assert.match(app, /currentWorkspace\?\.branding\?\.display_name/);
  assert.match(app, /currentWorkspace\?\.branding\?\.logo_url/);
  assert.match(app, /branding\.primary_color/);
  assert.match(app, /tenantMark\.textContent = mark/);
  assert.match(index, /<span class="beta-badge">BETA<\/span>/);
  assert.doesNotMatch(`${app}\n${index}\n${styles}`, /Arctic Foxes|North Hills|SHAHA|Gilmour/);
});

test('Stage 1.3 preserves real-data dashboard, context isolation, and login-first bootstrap', () => {
  assert.match(app, /function activeRosterPlayers/);
  assert.match(app, /<strong class="metric-value">\$\{playersCount\} Players<\/strong>/);
  assert.match(app, /function phase1NextScheduledGame/);
  assert.match(app, /function phase1LatestCompletedGame/);
  assert.match(app, /clearTenantState\(\);\s*render\(\);\s*try \{\s*const workspace = await workspaceAccessManager\.resolveWorkspace/);
  assert.match(app, /showLogin\(\);\s*\n\s*supabaseClient\.auth\.getSession\(\)/);
});
