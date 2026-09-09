const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');
const functionSource = fs.readFileSync('supabase/functions/invite-staff/index.ts', 'utf8');
const deliveryMigration = fs.readFileSync('supabase/migrations/20260909000300_022_reconciled_workspace_invite_delivery.sql', 'utf8');

test('web invite flow keeps service-role access server-side', () => {
  assert.match(app, /functions\.invoke\(INVITE_FUNCTION/);
  assert.doesNotMatch(app, /SERVICE_ROLE|service_role/i);
  assert.match(functionSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(functionSource, /admin\.users/);
});

test('invite-staff generates a raw token, hashes it with SHA-256, and never persists or returns the raw value', () => {
  assert.match(functionSource, /crypto\.getRandomValues\(bytes\)/);
  assert.match(functionSource, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(functionSource, /function generateRawInviteToken/);
  assert.match(functionSource, /function hashInviteToken/);
  assert.match(functionSource, /const tokenHash = await hashInviteToken\(rawToken\)/);
  // The raw token only ever flows into the redirect URL builder and the
  // email delivery helper — never into a JSON response or a console call.
  assert.match(functionSource, /buildInviteRedirectUrl\(rawToken\)/);
  assert.match(functionSource, /deliverInviteEmail\(context, email, displayName, rawToken\)/);
  assert.doesNotMatch(functionSource, /console\.[a-z]+\([^)]*rawToken/);
  assert.doesNotMatch(functionSource, /json\([^;]*rawToken/s);
  // inviteStaff/resendSetupLink's own returned response objects (message,
  // status, role_id) never reference the raw token.
  assert.doesNotMatch(functionSource, /message:[^}]*rawToken/s);
});

test('invite-staff never stores, returns, or logs a raw token and never exposes token_hash', () => {
  assert.doesNotMatch(functionSource, /(?<!target_)\btoken_hash\b\s*:/);
  assert.doesNotMatch(functionSource, /\.token_hash/);
  assert.doesNotMatch(functionSource, /console\.[a-z]+\([^)]*token/i);
  // The only appearances of "token_hash" are as RPC parameter names sent to
  // the database, never as a field read back from a response.
  assert.match(functionSource, /target_token_hash: tokenHash/);
});

test('invite-staff persists invites through create_workspace_invite and never writes team_memberships or profiles directly', () => {
  assert.match(functionSource, /callerClient\.rpc\('create_workspace_invite'/);
  assert.doesNotMatch(functionSource, /\.from\('team_memberships'\)\s*\.\s*insert/);
  assert.doesNotMatch(functionSource, /\.from\('team_memberships'\)\s*\.\s*upsert/);
  assert.doesNotMatch(functionSource, /\.from\('profiles'\)\s*\.\s*(insert|upsert)/);
  assert.doesNotMatch(functionSource, /auth\.admin\.deleteUser/);
});

test('invite-staff lists and resends through the safe list_workspace_invites RPC, never a direct table read', () => {
  assert.match(functionSource, /callerClient\.rpc\(\s*\n?\s*'list_workspace_invites'/);
  assert.doesNotMatch(functionSource, /\.from\('workspace_invites'\)/);
  assert.match(functionSource, /async function listWorkspaceInvites/);
  assert.match(functionSource, /async function listInvites/);
});

test('invite-staff resend rotates the token in place through database delivery controls', () => {
  assert.match(functionSource, /rotate_workspace_invite_delivery_token/);
  assert.match(functionSource, /claim_workspace_invite_delivery/);
  assert.match(functionSource, /record_workspace_invite_delivery/);
  assert.doesNotMatch(functionSource, /resendCooldowns/);
  assert.match(functionSource, /async function resendSetupLink/);
  assert.match(functionSource, /payload\?\.action === 'resend_setup'/);
});

test('invite email delivery redirects with the raw token as a query parameter when feasible', () => {
  assert.match(functionSource, /function buildInviteRedirectUrl/);
  assert.match(functionSource, /INVITE_REDIRECT_URL/);
  assert.match(functionSource, /searchParams\.set\('invite_token', rawToken\)/);
  assert.match(functionSource, /auth\.admin\.inviteUserByEmail/);
  assert.match(functionSource, /resetPasswordForEmail/);
  assert.match(functionSource, /if \(!base\) throw new Error\('Invite redirect URL is not configured\.'\)/);
  assert.match(functionSource, /url\.protocol !== 'https:'/);
});

test('invite-staff derives the invite plan from resolve_workspace_plan rather than trusting client input', () => {
  assert.match(functionSource, /callerClient\.rpc\(\s*\n?\s*'resolve_workspace_plan'/);
  assert.doesNotMatch(functionSource, /payload\.planId/);
  assert.doesNotMatch(functionSource, /payload\?\.planId/);
});

test('invite delivery state and resend cooldown are enforced in the database', () => {
  assert.match(deliveryMigration, /email_sending/);
  assert.match(deliveryMigration, /interval '2 minutes'/);
  assert.match(deliveryMigration, /interval '60 seconds'/);
  assert.match(deliveryMigration, /pending_controlled_delivery/);
  assert.match(deliveryMigration, /target_failure_reason/);
  assert.match(deliveryMigration, /rotate_workspace_invite_delivery_token/);
  assert.match(deliveryMigration, /update public\.workspace_invites\s+set token_hash = target_token_hash/);
  assert.match(deliveryMigration, /public\.is_platform_admin\(\)\s+or public\.has_team_capability/);
});

test('invite-staff only exposes assistant roles', () => {
  assert.match(app, /assistant_goalie/);
  assert.match(app, /value="assistant"/);
  assert.match(functionSource, /new Set\(\['assistant_goalie', 'assistant'\]\)/);
});

test('admin UI is cache-busted to the invite-flow build', () => {
  assert.match(index, /app\.js\?v=multi-team-1/);
  assert.match(app, /id="inviteForm"/);
  assert.match(app, /id="inviteList"/);
});

test('invite-staff edge function is team-agnostic and never hardcodes Arctic Foxes', () => {
  assert.doesNotMatch(functionSource, /arctic-foxes/i);
  assert.match(functionSource, /payload\?\.teamSlug/);
  assert.match(functionSource, /has_team_capability/);
  assert.match(functionSource, /\.eq\('slug', teamSlug\)/);
});

test('invite-staff authorizes RPC calls with the caller\'s own JWT, not the service-role key', () => {
  assert.match(functionSource, /const callerClient = createClient\(supabaseUrl, anonKey, \{/);
  assert.match(functionSource, /callerClient\.rpc\(\s*'has_team_capability'/);
  assert.match(functionSource, /callerClient\.rpc\('create_workspace_invite'/);
  assert.match(functionSource, /callerClient\.rpc\(\s*\n?\s*'list_workspace_invites'/);
});

test('invite errors cannot log or return a provider message containing a raw token', () => {
  assert.match(functionSource, /console\.error\('Staff invite request failed\.'\)/);
  assert.doesNotMatch(functionSource, /console\.error\([^)]*error\.message/);
  assert.match(functionSource, /throw new Error\('Invitation email delivery failed\.'\)/);
  assert.doesNotMatch(functionSource, /throw emailError/);
});

test('authenticated invite links are hashed, redeemed, and scrubbed before workspace routing', () => {
  assert.match(app, /queryParams\.get\('invite_token'\)/);
  assert.match(app, /key !== 'invite_token'/);
  assert.match(app, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(app, /rpc\('accept_workspace_invite'/);
  assert.match(app, /await acceptPendingWorkspaceInvite\(\)/);
  assert.ok(app.indexOf('await acceptPendingWorkspaceInvite()') < app.indexOf('await platformAccessManager.load()'));
  assert.match(app, /\['pending', 'expired'\]\.includes\(invite\.status\)/);
  assert.doesNotMatch(app, /invite\.status === 'invited'/);
});

test('platform admins may resend globally but only team managers may create staff invites', () => {
  assert.match(functionSource, /canManageTeam: !capabilityResult\.error && capabilityResult\.data === true/);
  assert.match(functionSource, /if \(!context\.canManageTeam\)/);
  assert.match(functionSource, /Team owner permission is required to create a staff invite\./);
  assert.match(deliveryMigration, /public\.is_platform_admin\(\)\s+or public\.has_team_capability/);
});