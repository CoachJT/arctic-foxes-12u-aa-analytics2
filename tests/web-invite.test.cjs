const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('web/app.js', 'utf8');
const index = fs.readFileSync('web/index.html', 'utf8');
const functionSource = fs.readFileSync('supabase/functions/invite-staff/index.ts', 'utf8');
const deliveryMigration = fs.readFileSync('supabase/migrations/20260909000300_022_reconciled_workspace_invite_delivery.sql', 'utf8');
const resolveTeamMigration = fs.readFileSync('supabase/migrations/20260911000100_026_resolve_invite_team.sql', 'utf8');

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
  assert.match(index, /app\.js\?v=schedule-linkage-2/);
  assert.match(app, /id="inviteForm"/);
  assert.match(app, /id="inviteList"/);
});

test('invite-staff edge function is team-agnostic and never hardcodes Arctic Foxes', () => {
  assert.doesNotMatch(functionSource, /arctic-foxes/i);
  assert.match(functionSource, /payload\?\.teamSlug/);
  assert.match(functionSource, /payload\?\.teamId/);
  // The slug is still what scopes the request; it is now passed to the guarded
  // resolver (migration 026) instead of a raw service-role table filter.
  assert.match(functionSource, /target_team_slug: teamSlug \|\| null/);
  assert.match(functionSource, /target_team_id: teamId \|\| null/);
});

test('invite-staff authorizes RPC calls with the caller\'s own JWT, not the service-role key', () => {
  assert.match(functionSource, /const callerClient = createClient\(supabaseUrl, anonKey, \{/);
  // Team resolution and its authorization now happen inside a caller-scoped
  // RPC, so has_team_capability is enforced in the database rather than by a
  // separate client-side call.
  assert.match(functionSource, /callerClient\.rpc\('resolve_invite_team'/);
  assert.match(resolveTeamMigration, /has_team_capability/);
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
  assert.match(functionSource, /canManageTeam: resolved\.can_manage_team === true/);
  assert.match(functionSource, /isPlatformAdmin: resolved\.is_platform_admin === true/);
  assert.match(functionSource, /if \(!context\.canManageTeam\)/);
  assert.match(functionSource, /Team owner permission is required to create a staff invite\./);
  assert.match(deliveryMigration, /public\.is_platform_admin\(\)\s+or public\.has_team_capability/);
});

// --- Migration 026: staff invitation production outage -----------------------
// Two independent regressions broke every staff invitation in production:
//
//  A. Commit 66d81f0 moved the team lookup from the caller's client to the
//     service-role client so a platform admin with no team membership could
//     still manage invites. service_role bypasses RLS but NOT table-level
//     privileges, and migration 002 granted it SELECT on only `profiles` and
//     `team_memberships` -- never `teams`. Every invocation then died with
//     `42501 permission denied for table teams` inside getOwnerContext, before
//     any action ran.
//  B. Commit c47b394 made invite-staff multi-team and started rejecting any
//     request without a team, but only the `invite` caller in web/app.js was
//     updated. The `list` and `resend_setup` callers kept sending no team, so
//     they failed with "A valid team is required."
//
// These tests pin both fixes so neither can silently regress.

test('invite-staff resolves the team through a guarded RPC, never a service-role table read', () => {
  // The service-role client must never touch `teams` again.
  assert.doesNotMatch(functionSource, /adminClient[\s\S]{0,40}\.from\('teams'\)/);
  assert.doesNotMatch(functionSource, /teamQuery/);
  assert.match(functionSource, /callerClient\.rpc\('resolve_invite_team'/);

  // The only service-role table read left is one migration 002 actually grants.
  const serviceRoleTables = [...functionSource.matchAll(/adminClient[\s\S]{0,60}?\.from\('([a-z_]+)'\)/g)]
    .map(match => match[1]);
  const granted = new Set(['profiles', 'team_memberships', 'onboarding_progress']);
  for (const table of serviceRoleTables) {
    assert.ok(granted.has(table), `service_role has no SELECT grant on ${table}`);
  }
});

test('migration 026 authorizes the team lookup and refuses to widen service_role', () => {
  // Authorization lives inside the resolver, so the lookup cannot be split
  // from the permission check.
  assert.match(resolveTeamMigration, /security definer/);
  assert.match(resolveTeamMigration, /stable/);
  assert.match(resolveTeamMigration, /set search_path = public/);
  assert.match(resolveTeamMigration, /has_team_capability\(found_team\.id, 'admin\.users'\)/);
  assert.match(resolveTeamMigration, /is_platform_admin\(\)/);
  assert.match(resolveTeamMigration, /if not \(caller_manages or caller_is_platform_admin\) then\s*\n\s*return;/);

  // An unknown team and an unauthorized team must both return zero rows so
  // teams cannot be enumerated by probing slugs.
  assert.match(resolveTeamMigration, /if found_team\.id is null then[\s\S]{0,200}?return;/);

  // Least privilege: anon cannot call it, and the outage is NOT fixed by
  // granting service_role read access to every team on the platform.
  assert.match(resolveTeamMigration, /revoke all on function public\.resolve_invite_team\(text, uuid\) from public;/);
  assert.match(resolveTeamMigration, /revoke all on function public\.resolve_invite_team\(text, uuid\) from anon;/);
  assert.match(resolveTeamMigration, /grant execute on function public\.resolve_invite_team\(text, uuid\) to authenticated;/);

  // Assert against executable SQL only -- the rationale comments legitimately
  // mention the grant we are refusing to add.
  const sqlOnly = resolveTeamMigration.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(sqlOnly, /grant\s+select[\s\S]{0,80}?public\.teams\s+to\s+service_role/i);

  // Read-only: the resolver must not mutate anything.
  assert.doesNotMatch(sqlOnly, /\b(insert into|update public\.|delete from)\b/i);
});

test('every invite-staff action sends the active team context', () => {
  // getOwnerContext runs for all three actions, so all three callers need it.
  assert.match(app, /function inviteTeamContext\(\)/);
  assert.match(app, /teamSlug: authTeam\?\.teams\?\.slug \|\| ''/);
  assert.match(app, /teamId: authTeam\?\.team_id \|\| ''/);

  assert.match(app, /body: \{ action: 'list', \.\.\.teamContext \}/);
  assert.match(app, /body: \{ action: 'resend_setup', userId, \.\.\.inviteTeamContext\(\) \}/);
  assert.match(app, /action: 'invite',[\s\S]{0,200}?\.\.\.inviteTeamContext\(\)/);

  // No invite-staff call may go out without a team again.
  assert.doesNotMatch(app, /body: \{ action: 'list' \}/);
  assert.doesNotMatch(app, /body: \{ action: 'resend_setup', userId \}/);
});

test('the invite panel degrades safely when no team is active', () => {
  // Without a team the Edge Function can only throw, so do not call it at all.
  assert.match(app, /if \(!teamContext\.teamSlug && !teamContext\.teamId\) \{/);
  assert.match(app, /Select a team to view invite status\./);
});

test('the invite hotfix preserves the workspace_invites lifecycle protections', () => {
  // The fix is scoped to team resolution; none of the invite guarantees move.
  assert.match(functionSource, /rpc\('create_workspace_invite'/);
  assert.match(functionSource, /rpc\(\s*'list_workspace_invites'/);
  assert.match(functionSource, /rpc\(\s*'claim_workspace_invite_delivery'/);
  assert.match(functionSource, /rpc\(\s*'rotate_workspace_invite_delivery_token'/);
  assert.match(functionSource, /rpc\('record_workspace_invite_delivery'/);
  assert.match(functionSource, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(functionSource, /allowedRoles = new Set\(\['assistant_goalie', 'assistant'\]\)/);
  // Team scope is still derived from the resolved team, never from the payload.
  assert.match(functionSource, /target_team_id: context\.team\.id/);
  assert.match(functionSource, /target_organization_id: context\.team\.organization_id/);
});

