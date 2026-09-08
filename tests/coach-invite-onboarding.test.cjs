'use strict';

// Regression coverage for the first-coach onboarding path:
// admin onboarding -> automatic invite email -> invited coach opens the link ->
// first-time account creation or sign-in -> atomic invitation acceptance ->
// organization + team membership -> workspace load.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

const readFile = (...segments) => fs.readFileSync(path.join(root, ...segments), 'utf8');

const app = readFile('web', 'app.js');
const deliveryMigration = readFile('supabase', 'migrations', '018_coach_invite_email_delivery.sql');
const acceptanceMigration = readFile('supabase', 'migrations', '010_secure_workspace_invite_acceptance.sql');
const onboardingMigration = readFile('supabase', 'migrations', '015_beta_onboarding.sql');
const sendFunction = readFile('supabase', 'functions', 'send-beta-onboarding-invite', 'index.ts');
const contextFunction = readFile('supabase', 'functions', 'workspace-invite-context', 'index.ts');
const claimFunction = readFile('supabase', 'functions', 'claim-workspace-invite', 'index.ts');
const acceptFunction = readFile('supabase', 'functions', 'accept-workspace-invite', 'index.ts');
const functionsWorkflow = readFile('.github', 'workflows', 'deploy-supabase-functions.yml');
const supabaseConfig = readFile('supabase', 'config.toml');

function extractFunction(source, name) {
  const start = [`async function ${name}(`, `function ${name}(`]
    .map(signature => source.indexOf(signature))
    .find(index => index !== -1);
  assert.notEqual(start, undefined, `Expected ${name} to exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadDeliverInvite(invokeImplementation) {
  const context = {
    BETA_ONBOARDING_SEND_FUNCTION: 'send-beta-onboarding-invite',
    supabaseClient: { functions: { invoke: invokeImplementation } }
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(app, 'deliverBetaOnboardingInvite'), context);
  return context.deliverBetaOnboardingInvite;
}

// 1. Onboarding automatically sends the first-coach invite.
test('successful onboarding sends the first-coach invitation without operator action', () => {
  const submit = extractFunction(app, 'submitBetaOnboarding');
  assert.match(submit, /await deliverBetaOnboardingInvite\(result\.invite_id\)/);
  assert.match(submit, /betaOnboardingSummary = \{ \.\.\.betaOnboardingSummary, \.\.\.delivery \}/);
  assert.match(app, /The first coach is emailed a secure invitation link automatically\./);
  assert.doesNotMatch(app, /One-time acceptance link/);
});

test('delivery invokes the send function and reports success', async () => {
  const calls = [];
  const deliver = loadDeliverInvite(async (slug, options) => {
    calls.push({ slug, body: options.body });
    return { data: { delivered: true }, error: null };
  });
  assert.deepEqual({ ...(await deliver('invite-1')) }, { emailDelivered: true, emailError: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ slug: 'send-beta-onboarding-invite', body: { inviteId: 'invite-1', resend: false } }]);
});

// 2. Email failure preserves the workspace and the pending invitation.
test('email failure keeps the workspace and reports a recoverable message', async () => {
  const deliver = loadDeliverInvite(async () => ({ data: null, error: new Error('smtp unavailable') }));
  const result = await deliver('invite-1');
  assert.equal(result.emailDelivered, false);
  assert.equal(result.emailError, 'smtp unavailable');

  const submit = extractFunction(app, 'submitBetaOnboarding');
  // Delivery is awaited after the workspace exists and its result is merged
  // into the summary rather than thrown, so nothing is rolled back.
  assert.ok(submit.indexOf('beta_onboard_workspace') < submit.indexOf('deliverBetaOnboardingInvite'));
  assert.doesNotMatch(submit, /deliverBetaOnboardingInvite[\s\S]*throw/);
  assert.match(app, /Team created — invitation email could not be sent\./);

  assert.match(sendFunction, /target_delivered: false/);
  assert.match(sendFunction, /the invite stays pending either way/);
  assert.match(deliveryMigration, /next_state := case when target_delivered then 'email_sent' else 'pending_controlled_delivery' end/);
});

// 3. Resend Invite works.
test('resend invite is offered and forces a fresh delivery attempt', async () => {
  assert.match(app, /id="resendBetaOnboardingInvite"/);
  assert.match(app, /Resend invite/);
  assert.match(app, /querySelector\('#resendBetaOnboardingInvite'\)\?\.addEventListener\('click', resendBetaOnboardingInvite\)/);

  const resend = extractFunction(app, 'resendBetaOnboardingInvite');
  assert.match(resend, /deliverBetaOnboardingInvite\(betaOnboardingSummary\.inviteId, true\)/);

  const calls = [];
  const deliver = loadDeliverInvite(async (slug, options) => {
    calls.push(options.body);
    return { data: { delivered: true }, error: null };
  });
  await deliver('invite-1', true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ inviteId: 'invite-1', resend: true }]);
});

// 4. Duplicate onboarding does not create duplicate invitations or emails.
test('delivery is claimed atomically so retries cannot send duplicate invitations', async () => {
  assert.match(deliveryMigration, /create or replace function public\.claim_beta_onboarding_invite_delivery/);
  assert.match(deliveryMigration, /for update/);
  assert.match(deliveryMigration, /'already_sent'/);
  assert.match(deliveryMigration, /'delivery_in_progress'/);
  assert.match(deliveryMigration, /'resend_cooldown'/);
  // Automatic delivery may never re-send; only an explicit resend may.
  assert.match(deliveryMigration, /if not allow_resend then[\s\S]{0,200}'already_sent'/);
  assert.match(sendFunction, /if \(!claim\?\.claimed\)/);
  // The send function returns before any email when the claim is refused.
  assert.ok(sendFunction.indexOf("if (!claim?.claimed)") < sendFunction.indexOf('sendInviteEmail({'));

  const deliver = loadDeliverInvite(async () => ({
    data: { delivered: false, skipped: true, reason: 'already_sent' },
    error: null
  }));
  assert.deepEqual({ ...(await deliver('invite-1')) }, { emailDelivered: true, emailError: '' });
});

test('resending rotates the existing invitation in place instead of creating another row', () => {
  assert.match(deliveryMigration, /create or replace function public\.rotate_beta_onboarding_invite_token/);
  assert.match(deliveryMigration, /update public\.workspace_invites\s+set token_hash = target_token_hash/);
  assert.doesNotMatch(deliveryMigration, /insert into public\.workspace_invites/);
  assert.match(deliveryMigration, /Only a pending Beta onboarding invite can be reissued\./);
});

// 5. A brand-new coach creates a first password.
test('an invited coach without an account is offered account creation, not a password prompt', () => {
  assert.match(app, /Create your PuckNexus account/);
  assert.match(app, /if \(workspaceInviteToken\) \{\s*return showInviteLanding\(workspaceInviteToken\);/);

  const landing = extractFunction(app, 'renderInviteLanding');
  assert.match(landing, /context\.account_exists \? 'Sign in to accept invitation' : 'Create your PuckNexus account'/);
  assert.match(landing, /autocomplete="new-password" minlength="12"/);
  assert.match(landing, /invitePasswordConfirm/);
  assert.match(landing, /The passwords do not match\./);
  // The invited address is prefilled and locked.
  assert.match(landing, /id="inviteEmail"[^`]*value="\$\{escapeHtml\(context\.email\)\}" readonly required/);
  assert.match(landing, /WORKSPACE_INVITE_CLAIM_FUNCTION,\s*\{ body: \{ token, password \} \}/);

  assert.match(claimFunction, /auth\.admin\.createUser\(\{/);
  assert.match(claimFunction, /email_confirm: true/);
  assert.match(claimFunction, /at least 12 characters/);
});

// 6. An existing user signs in to accept.
test('an invited coach who already has an account is asked to sign in', () => {
  assert.match(app, /Sign in to accept invitation/);
  const landing = extractFunction(app, 'renderInviteLanding');
  assert.match(landing, /autocomplete="current-password"/);
  assert.match(landing, /signInWithPassword\(\{\s*email: context\.email,\s*password\s*\}\)/);
  // A race where the account appears mid-flow falls back to sign-in.
  assert.match(landing, /data\?\.reason === 'account_exists'/);
  assert.match(claimFunction, /reason: 'account_exists'/);
  assert.match(contextFunction, /account_exists: invite\.account_exists === true/);
});

test('the invitation survives authentication and is accepted only afterwards', () => {
  const landing = extractFunction(app, 'renderInviteLanding');
  // Account creation must not consume the invite; acceptance happens after sign-in.
  assert.ok(landing.indexOf('signInWithPassword') < landing.indexOf('loadAuthenticatedWorkspace'));
  assert.doesNotMatch(claimFunction, /rpc\('accept_workspace_invite'/);
  assert.match(claimFunction, /does NOT accept the invitation/);

  const load = extractFunction(app, 'loadAuthenticatedWorkspace');
  assert.ok(load.indexOf('acceptWorkspaceInviteForSignedInUser') < load.indexOf('loadAuthorizedWorkspaces'));
});

// 7/8/9. Acceptance creates the correct organization membership, team
// membership, and coach role in one transaction.
test('acceptance creates organization membership, team membership, and the invited role atomically', () => {
  assert.match(acceptanceMigration, /insert into public\.organization_memberships/);
  assert.match(acceptanceMigration, /insert into public\.team_memberships/);
  assert.match(acceptanceMigration, /insert into public\.profiles \(id, display_name\)/);
  // Role comes from the invitation, never from the client.
  assert.match(acceptanceMigration, /invite\.role_id is null/);
  assert.match(acceptanceMigration, /The invited team role is no longer valid\./);
  assert.match(acceptFunction, /forbiddenOverrides/);
  for (const field of ['organizationId', 'teamId', 'seasonId', 'roleId', 'planId', 'acceptedBy']) {
    assert.match(acceptFunction, new RegExp(`'${field}'`));
  }
  // A single security definer plpgsql function is one transaction, so an
  // invitation can never be marked accepted without its memberships.
  assert.match(acceptanceMigration, /create or replace function public\.accept_workspace_invite[\s\S]*language plpgsql\s+security definer/);
});

test('the accepted user is linked by auth.uid() rather than any client-supplied id', () => {
  assert.match(acceptanceMigration, /caller_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(acceptanceMigration, /lower\(trim\(caller_email\)\) <> invite\.email_normalized/);
  assert.match(acceptanceMigration, /caller_email_confirmed_at is null/);
  assert.match(acceptFunction, /await callerClient\.auth\.getUser\(\)/);
});

// 10/11/12. Workspace loads immediately, after refresh, and under RLS.
test('the acceptance endpoint the workspace loader depends on is deployable and configured', () => {
  // Root cause of "Unable to load your secure team workspace": this function
  // was committed but never deployed, so acceptance 404ed and no membership was
  // ever created.
  assert.match(functionsWorkflow, /supabase functions deploy --project-ref/);
  assert.match(functionsWorkflow, /name: Deploy Supabase Edge Functions/);
  for (const slug of [
    'accept-workspace-invite',
    'create-workspace-invite',
    'revoke-workspace-invite',
    'send-beta-onboarding-invite',
    'workspace-invite-context',
    'claim-workspace-invite'
  ]) {
    assert.match(supabaseConfig, new RegExp(`\\[functions\\.${slug}\\]`), `${slug} must declare its JWT posture`);
    assert.ok(
      fs.existsSync(path.join(root, 'supabase', 'functions', slug, 'index.ts')),
      `${slug} must have an entrypoint`
    );
  }
  // Only the two pre-authentication invite screens may skip JWT verification.
  const openFunctions = supabaseConfig
    .split(/\n(?=\[functions\.)/)
    .filter(block => /verify_jwt = false/.test(block))
    .map(block => block.match(/\[functions\.([a-z-]+)\]/)[1]);
  assert.deepEqual(openFunctions.sort(), ['claim-workspace-invite', 'workspace-invite-context']);
});

test('a newly accepted coach resolves and activates a workspace on load and on refresh', () => {
  const load = extractFunction(app, 'loadAuthenticatedWorkspace');
  assert.match(load, /workspaceAccessManager\.loadAuthorizedWorkspaces\(\)/);
  assert.match(load, /workspaceAccessManager\.chooseWorkspace\(\)/);
  assert.match(load, /await activateWorkspace\(selected\.organization_id, selected\.team_id, selected\.season_id\)/);
  // Refresh path: a restored session loads the workspace without an invite token.
  assert.match(app, /if \(session\?\.user\) \{\s*showLoading\(\);\s*return loadAuthenticatedWorkspace\(session\.user\);/);
  const accept = extractFunction(app, 'acceptWorkspaceInviteForSignedInUser');
  assert.match(accept, /if \(!workspaceInviteToken \|\| inviteAcceptanceAttempted\) return false/);
  // The consumed token is stripped from the URL so a refresh cannot replay it.
  assert.match(accept, /window\.history\.replaceState/);
});

test('workspace load failures surface their cause instead of being masked', () => {
  const load = extractFunction(app, 'loadAuthenticatedWorkspace');
  assert.match(load, /Unable to load your secure team workspace\. \$\{detail\}/);
  assert.match(load, /console\.error\('Could not load the authenticated workspace:', error\)/);
});

test('RLS-facing invite access stays server-side only', () => {
  assert.match(acceptanceMigration, /revoke all on public\.workspace_invites from public, anon, authenticated/);
  assert.match(deliveryMigration, /grant execute on function public\.lookup_workspace_invite_by_token\(text\) to service_role/);
  assert.match(deliveryMigration, /revoke all on function public\.lookup_workspace_invite_by_token\(text\) from public, anon, authenticated/);
  assert.match(deliveryMigration, /Pre-authentication invite lookup remains exposed to browser roles\./);
  assert.match(deliveryMigration, /Direct workspace invite table reads remain exposed\./);
  assert.match(contextFunction, /SUPABASE_SERVICE_ROLE_KEY/);
});

// 13/14/15. Invalid, expired, and used invitations are rejected.
test('invalid, expired, revoked, and already-used invitations are rejected', () => {
  assert.match(deliveryMigration, /target_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(deliveryMigration, /'already_accepted'/);
  assert.match(deliveryMigration, /'revoked'/);
  assert.match(deliveryMigration, /'expired'/);
  assert.match(deliveryMigration, /invite\.expires_at is not null and invite\.expires_at <= now\(\)/);
  assert.match(acceptanceMigration, /The invite is invalid, expired, revoked, or already accepted\./);

  for (const reason of ['invalid', 'expired', 'revoked', 'already_accepted']) {
    assert.match(app, new RegExp(`${reason}:`), `${reason} needs a coach-facing message`);
  }
  const landing = extractFunction(app, 'showInviteLanding');
  assert.match(landing, /if \(!context\?\.valid\)/);
  assert.match(landing, /INVITE_REJECTION_MESSAGES\[context\?\.reason\]/);
});

// 16. A failed account creation does not consume the invitation.
test('failed account creation leaves the invitation pending and unconsumed', () => {
  assert.match(claimFunction, /A failure[\s\S]{0,12}here therefore leaves the invitation pending and reusable\./);
  assert.doesNotMatch(claimFunction, /status.*=.*'accepted'/);
  const landing = extractFunction(app, 'renderInviteLanding');
  // A refused claim returns without signing in or accepting.
  assert.match(landing, /if \(!data\?\.created\) \{[\s\S]*?return;\s*\}/);
  assert.match(landing, /The invitation is left pending, so nothing is consumed by a failure\./);
});

// 17. Retrying acceptance cannot duplicate membership.
test('repeated acceptance is idempotent and cannot duplicate memberships', () => {
  assert.match(acceptanceMigration, /on conflict \(id\) do nothing/);
  assert.match(acceptanceMigration, /existing_org_membership/);
  assert.match(acceptanceMigration, /existing_team_membership/);
  assert.match(acceptanceMigration, /invite\.status <> 'pending'/);
  // Client-side replay guard.
  assert.match(app, /inviteAcceptanceAttempted = true/);
});

// Token hygiene across the whole path.
test('raw invite tokens are never logged, echoed, or persisted', () => {
  assert.match(deliveryMigration, /regexp_replace\(coalesce\(target_failure_reason, ''\), '\[A-Za-z0-9_\\-\]\{24,\}', '\[redacted\]', 'g'\)/);
  assert.match(sendFunction, /function safeErrorMessage/);
  assert.match(sendFunction, /replace\(\/\[A-Za-z0-9_-\]\{24,\}\/g, '\[redacted\]'\)/);
  // Tokens are only ever hashed before leaving the client or the function.
  for (const source of [sendFunction, contextFunction, claimFunction, acceptFunction]) {
    assert.match(source, /sha256Hex/);
    assert.doesNotMatch(source, /console\.(log|error|warn|info)/);
  }
  const landing = extractFunction(app, 'showInviteLanding');
  assert.match(landing, /The raw token is never included in any surfaced message or log\./);
  assert.doesNotMatch(landing, /console\./);
  // The admin summary no longer renders the acceptance link.
  assert.doesNotMatch(app, /inviteUrl: betaOnboardingInviteUrl/);
});

test('the onboarding RPC still seeds the delivery state the sender transitions from', () => {
  assert.match(onboardingMigration, /'delivery_state', 'pending_controlled_delivery'/);
  assert.match(deliveryMigration, /coalesce\(invite\.metadata->>'delivery_state', 'pending_controlled_delivery'\)/);
  assert.match(deliveryMigration, /'delivery_state', 'email_sending'/);
  assert.match(sendFunction, /INVITE_ACCEPT_URL/);
  assert.match(sendFunction, /RESEND_API_KEY/);
  assert.match(sendFunction, /INVITE_FROM_EMAIL/);
});

test('only a Platform Admin can trigger or record invitation delivery', () => {
  assert.match(deliveryMigration, /Platform Admin authorization is required to deliver a Beta onboarding invite\./);
  assert.match(deliveryMigration, /Platform Admin authorization is required to record Beta onboarding delivery\./);
  assert.match(deliveryMigration, /Platform Admin authorization is required to reissue a Beta onboarding invite\./);
  assert.match(deliveryMigration, /Anonymous Beta onboarding delivery execution remains granted\./);
  assert.match(sendFunction, /if \(!authorization\?\.startsWith\('Bearer '\)\) throw new Error\('Authentication is required\.'\)/);
});
