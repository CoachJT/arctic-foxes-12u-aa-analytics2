const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');
const functionSource = fs.readFileSync('supabase/functions/invite-staff/index.ts', 'utf8');

test('web invite flow keeps service-role access server-side', () => {
  assert.match(app, /functions\.invoke\(INVITE_FUNCTION/);
  assert.doesNotMatch(app, /SERVICE_ROLE|service_role/i);
  assert.match(functionSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(functionSource, /auth\.admin\.inviteUserByEmail/);
  assert.match(functionSource, /admin\.users/);
});

test('web invite flow only exposes assistant roles and creates invited membership', () => {
  assert.match(app, /assistant_goalie/);
  assert.match(app, /value="assistant"/);
  assert.match(functionSource, /new Set\(\['assistant_goalie', 'assistant'\]\)/);
  assert.match(functionSource, /status: 'invited'/);
  assert.match(functionSource, /invited_by: context\.caller\.id/);
  assert.doesNotMatch(functionSource, /auth\.admin\.deleteUser/);
});

test('partial Auth users are reused through recovery email before application records are written', () => {
  assert.match(functionSource, /existingUser\?\.id/);
  assert.match(functionSource, /resetPasswordForEmail\(email/);
  assert.match(functionSource, /existingMembership/);
  assert.match(functionSource, /Recovery email sent and pending membership created/);
  assert.match(functionSource, /if \(recoveryError\) throw recoveryError/);
  assert.match(functionSource, /if \(!userId \|\| emailOperation\)/);
  assert.match(functionSource, /if \(recoveryError\) throw recoveryError[\s\S]*?\.from\('profiles'\)[\s\S]*?\.upsert/);
});

test('admin UI is cache-busted to the invite-flow build', () => {
  assert.match(index, /app\.js\?v=phase1-read-1/);
  assert.match(app, /id="inviteForm"/);
  assert.match(app, /id="inviteList"/);
});
