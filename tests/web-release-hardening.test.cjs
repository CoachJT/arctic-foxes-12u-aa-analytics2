const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const appSource = fs.readFileSync('web/app.js', 'utf8');
const indexSource = fs.readFileSync('web/index.html', 'utf8');
const coachSource = fs.readFileSync('web/coach-qol.js', 'utf8');
const onboardingSource = fs.readFileSync('web/onboarding.js', 'utf8');
const adminSource = fs.readFileSync('web/platform-admin.js', 'utf8');
const resolverSource = fs.readFileSync('web/destination-resolver.js', 'utf8');
const accessSource = fs.readFileSync('web/platform-access.js', 'utf8');

test('prototype mode cannot activate on any production hostname', () => {
  assert.match(appSource, /\['localhost', '127\.0\.0\.1', '::1'\]\.includes\(location\.hostname\)/);
  assert.match(appSource, /prototypeHost\s*&&/);
  // The flag alone (a URL parameter) is never sufficient.
  assert.doesNotMatch(appSource, /prototypeMode\s*=\s*queryParams/);
});

test('client authorization never comes from storage, URLs, or editable profile data', () => {
  for (const source of [resolverSource, accessSource, adminSource, coachSource, onboardingSource]) {
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
  }
  for (const source of [resolverSource, accessSource, adminSource]) {
    assert.doesNotMatch(source, /user_metadata|app_metadata/);
  }
  // No destination or privilege is read from a URL parameter.
  assert.doesNotMatch(appSource, /queryParams\.get\('(admin|role|platform|destination|view|team)'\)/);
});

test('every versioned static asset carries a cache-busting version string', () => {
  const assets = [...indexSource.matchAll(/(?:src|href)="\.\/([a-z0-9-]+\.(?:js|css))(?:\?v=([a-z0-9-]+))?"/g)];
  assert.ok(assets.length >= 10, 'expected all app assets to be present');
  const unversioned = assets.filter(([, , version]) => !version).map(([, file]) => file);
  assert.deepEqual(unversioned, []);
});

test('coach-facing errors are translated, not raw database or RPC payloads', () => {
  // Save-state labels are human-readable.
  assert.match(coachSource, /Save failed — Retry/);
  assert.match(coachSource, /✓ Saved/);
  // No raw Postgres/PostgREST jargon leaks into coach-facing strings.
  const coachFacing = coachSource.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(coachFacing, /relation "|column ".*" does not exist|duplicate key value violates/);
});

test('admin invite actions and beta toggles always round-trip through guarded RPCs', () => {
  assert.match(adminSource, /functions\.invoke\('invite-staff'/);
  assert.match(adminSource, /action: 'resend_setup'/);
  assert.match(adminSource, /admin_revoke_invitation/);
  assert.match(adminSource, /admin_set_beta_status/);
  assert.doesNotMatch(adminSource, /\.from\('platform_roles'\)|\.from\('organizations'\)\.(insert|update|delete)/);
});

test('help bubbles are keyboard-accessible buttons with labels', () => {
  assert.match(coachSource, /class="help-bubble" type="button" aria-label="Help"/);
  assert.match(appSource, /aria-label="Help"/);
});

test('no auth tokens or secrets appear in any web source file', () => {
  const webFiles = fs.readdirSync('web').filter(f => f.endsWith('.js') || f.endsWith('.html'));
  for (const file of webFiles) {
    const source = fs.readFileSync(`web/${file}`, 'utf8');
    assert.doesNotMatch(source, /service_role|sb_secret_|eyJhbGciOi/, file);
  }
});

test('release documentation exists and covers the acceptance areas', () => {
  const checklist = fs.readFileSync('docs/PUCKNEXUS-2.0-RELEASE-CHECKLIST.md', 'utf8');
  for (const section of ['Authentication', 'Platform Admin', 'Onboarding', 'Coach workflows', 'Dashboard', 'Security', 'Devices']) {
    assert.match(checklist, new RegExp(`## ${section}`), section);
  }
  const deferred = fs.readFileSync('docs/PUCKNEXUS-2.0-DEFERRED.md', 'utf8');
  assert.match(deferred, /platform_admins/);
  assert.match(deferred, /logo upload/i);
  assert.match(deferred, /Electron/i);
});

test('invite edge function is generalized and validates team ownership server-side', () => {
  const fn = fs.readFileSync('supabase/functions/invite-staff/index.ts', 'utf8');
  assert.doesNotMatch(fn, /arctic-foxes/i);
  assert.match(fn, /has_team_capability/);
  assert.match(fn, /SUPABASE_SERVICE_ROLE_KEY/);
  // Team slug is requested by the caller but always validated against the
  // caller's ownership via has_team_capability before any admin action.
  assert.match(fn, /\.eq\('slug', teamSlug\)/);
});
