'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '015_beta_onboarding.sql'),
  'utf8'
);
const app = fs.readFileSync(path.join(root, 'web', 'app.js'), 'utf8');
const entitlementMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '008_entitlement_and_pending_invites.sql'),
  'utf8'
);
const brandingMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '014_organization_branding_asset_pipeline.sql'),
  'utf8'
);
const reissueFunction = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'reissue-beta-onboarding-invite', 'index.ts'),
  'utf8'
);

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `Expected ${name} to exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function acceptanceHarness(invoke) {
  const context = {
    Error,
    Promise,
    workspaceInviteToken: 'accepted-by-secure-edge-function',
    inviteAcceptanceAttempted: false,
    WORKSPACE_INVITE_ACCEPT_FUNCTION: 'accept-workspace-invite',
    supabaseClient: { functions: { invoke } },
    window: { history: { replaceState() {} } },
    document: { title: 'PuckNexus' },
    location: { pathname: '/', search: '' }
  };
  vm.runInNewContext(`${extractFunction(app, 'acceptWorkspaceInviteForSignedInUser')}; this.accept = acceptWorkspaceInviteForSignedInUser;`, context);
  return context;
}

test('controlled Beta onboarding has a dedicated platform-admin-only authority', () => {
  assert.match(migration, /create or replace function public\.get_platform_authorization/);
  assert.match(migration, /create or replace function public\.beta_onboard_workspace/);
  assert.match(migration, /if not public\.is_platform_admin\(\) then/);
  assert.match(migration, /Platform Admin authorization is required for Beta onboarding/);
  assert.match(migration, /revoke all on function public\.beta_onboard_workspace/);
  assert.match(migration, /grant execute on function public\.beta_onboard_workspace/);
  assert.match(app, /rpc\('get_platform_authorization'\)/);
  assert.match(app, /rpc\('beta_onboard_workspace'/);
});

test('team owners and organization administrators cannot obtain platform access', () => {
  assert.match(migration, /permission\.capability = 'platform\.admin'/);
  assert.match(migration, /Platform administration must not be granted through a team role/);
  const rolePermissionSeeds = migration.slice(
    migration.indexOf('insert into public.role_permissions'),
    migration.indexOf('create or replace function public.get_platform_authorization')
  );
  assert.doesNotMatch(rolePermissionSeeds, /'platform\.admin'/);
  const onboardingFunction = migration.slice(
    migration.indexOf('create or replace function public.beta_onboard_workspace'),
    migration.indexOf('revoke all on function public.get_platform_authorization')
  );
  assert.doesNotMatch(onboardingFunction, /has_org_role|is_team_owner/);
  assert.match(brandingMigration, /create table public\.platform_admins/);
  assert.match(brandingMigration, /user_id = \(select auth\.uid\(\)\)/);
});

test('onboarding provisions organization, team, season, entitlement, branding, and invitation together', () => {
  for (const statement of [
    'insert into public.organizations',
    'insert into public.teams',
    'insert into public.seasons',
    'update public.teams',
    'insert into public.team_branding',
    'insert into public.organization_entitlements',
    'insert into public.workspace_invites'
  ]) {
    assert.match(migration, new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(migration, /language plpgsql/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /organization_id, team_id, season_id, role_id, plan_id, token_hash/);
  assert.match(migration, /workspace_organization\.id, workspace_team\.id, workspace_season\.id/);
});

test('all rejectable input and authorization checks run before workspace writes, so failed calls roll back cleanly', () => {
  const onboardingFunction = migration.slice(
    migration.indexOf('create or replace function public.beta_onboard_workspace'),
    migration.indexOf('revoke all on function public.get_platform_authorization')
  );
  const firstWorkspaceWrite = onboardingFunction.indexOf('insert into public.organizations');
  assert.ok(firstWorkspaceWrite > 0);
  for (const check of [
    'Authentication is required.',
    'Platform Admin authorization is required for Beta onboarding.',
    'Valid organization, team, and season details are required.',
    'A valid season date range is required.',
    'An active Beta plan is required.',
    'Stable logo URL and valid branding colors are required.',
    'A valid first-coach invitation is required.'
  ]) {
    assert.ok(onboardingFunction.indexOf(check) < firstWorkspaceWrite, `${check} must precede writes`);
  }
  assert.doesNotMatch(onboardingFunction, /\bexception\s+when\b/i);
  assert.match(app, /No partial workspace was saved/);
});

test('only supported entitlement plans are accepted and assigned at organization and invite scope', () => {
  for (const plan of ['CORE', 'COACH', 'ELITE', 'FOUNDING', 'ORGANIZATION']) {
    assert.match(migration, new RegExp(`'${plan}'`));
  }
  assert.match(migration, /plan\.plan_id = normalized_plan_id/);
  assert.match(migration, /organization_id, plan_id, status, metadata/);
  assert.match(migration, /target_coach_role_id, normalized_plan_id, target_token_hash/);
  assert.match(entitlementMigration, /create or replace function public\.resolve_workspace_plan/);
});

test('first-coach invitation remains tenant-scoped and uses only known team roles', () => {
  assert.match(migration, /target_coach_role_id not in \('owner', 'head_coach', 'assistant', 'team_manager', 'video_coach'\)/);
  assert.match(migration, /normalized_email !~ '\^\[\^@\\s\]\+@\[\^@\\s\]\+\\\.\[\^@\\s\]\+\$'/);
  assert.match(migration, /target_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /'delivery_state', 'pending_controlled_delivery'/);
  assert.match(app, /First coach role/);
  assert.match(app, /No email is sent from this screen/);
  assert.match(app, /One-time acceptance link/);
  assert.match(app, /accept-workspace-invite/);
  assert.match(app, /body: \{ token: workspaceInviteToken \}/);
});

test('initial onboarding invites have an explicit 72-hour expiry and acceptance retains expiry, replay, and email checks', () => {
  assert.match(migration, /now\(\) \+ interval '72 hours'/);
  assert.match(migration, /email_normalized, display_name, invited_by, status, expires_at, metadata/);
  const acceptanceMigration = fs.readFileSync(
    path.join(root, 'supabase', 'migrations', '010_secure_workspace_invite_acceptance.sql'),
    'utf8'
  );
  assert.match(acceptanceMigration, /invite\.expires_at is not null and invite\.expires_at <= now\(\)/);
  assert.match(acceptanceMigration, /lower\(trim\(caller_email\)\) <> invite\.email_normalized/);
  assert.match(acceptanceMigration, /invite\.status <> 'pending'/);
});

test('only a Platform Admin can revoke a still-pending onboarding invitation', () => {
  assert.match(migration, /create or replace function public\.revoke_beta_onboarding_invite/);
  assert.match(migration, /Platform Admin authorization is required to revoke a Beta onboarding invite/);
  assert.match(migration, /existing_invite\.status <> 'pending'/);
  assert.match(migration, /existing_invite\.metadata->>'source' <> 'beta_onboarding'/);
  assert.match(migration, /set status = 'revoked'/);
  assert.match(migration, /revoke all on function public\.revoke_beta_onboarding_invite\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.revoke_beta_onboarding_invite\(uuid\) to authenticated/);
});

test('reissue atomically revokes only a pending onboarding invite and preserves its workspace scope', () => {
  const reissueMigration = migration.slice(
    migration.indexOf('create or replace function public.reissue_beta_onboarding_invite'),
    migration.indexOf('revoke all on function public.get_platform_authorization')
  );
  assert.match(reissueMigration, /Platform Admin authorization is required to reissue a Beta onboarding invite/);
  assert.match(reissueMigration, /where invite\.id = target_invite_id\s+for update/);
  assert.match(reissueMigration, /existing_invite\.status <> 'pending'/);
  assert.match(reissueMigration, /existing_invite\.metadata->>'source' <> 'beta_onboarding'/);
  assert.match(reissueMigration, /where invite\.token_hash = target_token_hash/);
  assert.match(reissueMigration, /update public\.workspace_invites\s+set status = 'revoked'/);
  assert.match(reissueMigration, /return query\s+insert into public\.workspace_invites/);
  assert.match(reissueMigration, /existing_invite\.organization_id, existing_invite\.team_id/);
  assert.match(reissueMigration, /existing_invite\.season_id, existing_invite\.role_id/);
  assert.match(reissueMigration, /existing_invite\.plan_id, target_token_hash/);
  assert.match(reissueMigration, /existing_invite\.email_normalized, existing_invite\.display_name/);
  assert.match(reissueMigration, /now\(\) \+ interval '72 hours'/);
  assert.doesNotMatch(reissueMigration, /team_memberships|organization_entitlements|team_membership_entitlements/);
});

test('reissue Edge Function returns a fresh token once without plaintext persistence or service-role access', () => {
  assert.match(reissueFunction, /crypto\.getRandomValues/);
  assert.match(reissueFunction, /crypto\.subtle\.digest/);
  assert.match(reissueFunction, /reissue_beta_onboarding_invite/);
  assert.match(reissueFunction, /token: rawToken/);
  assert.match(reissueFunction, /invite_url: inviteUrl\(rawToken\)/);
  assert.doesNotMatch(reissueFunction, /SUPABASE_SERVICE_ROLE_KEY|console\.(log|info|error)[\s\S]*rawToken/);
  assert.match(app, /reissue-beta-onboarding-invite/);
  assert.match(app, /revoke_beta_onboarding_invite/);
});

test('acceptance blocks concurrent requests but resets its guard after a failure', async () => {
  let resolveInvoke;
  let calls = 0;
  const context = acceptanceHarness(() => {
    calls += 1;
    return new Promise(resolve => { resolveInvoke = resolve; });
  });
  const firstAttempt = context.accept();
  assert.equal(await context.accept(), false);
  assert.equal(calls, 1);
  resolveInvoke({ error: new Error('transient failure') });
  await assert.rejects(firstAttempt, /transient failure/);
  assert.equal(context.inviteAcceptanceAttempted, false);
});

test('a transient failure or wrong-user rejection can be retried after the coach signs in again', async () => {
  let result = { error: new Error('The authenticated email does not match the invite.') };
  let calls = 0;
  const context = acceptanceHarness(async () => {
    calls += 1;
    return result;
  });
  await assert.rejects(context.accept(), /does not match/);
  assert.equal(context.inviteAcceptanceAttempted, false);
  result = { error: null };
  assert.equal(await context.accept(), true);
  assert.equal(calls, 2);
  assert.equal(context.inviteAcceptanceAttempted, true);
  assert.match(app, /inviteAcceptanceAttempted = false;/);
});

test('a successfully accepted invite remains consumed by the client acceptance guard', async () => {
  let calls = 0;
  const context = acceptanceHarness(async () => {
    calls += 1;
    return { error: null };
  });
  assert.equal(await context.accept(), true);
  assert.equal(await context.accept(), false);
  assert.equal(calls, 1);
});

test('brand input is constrained to a stable HTTPS URL and three colors', () => {
  assert.match(migration, /target_branding_logo_url !~ '\^https:\/\//);
  for (const color of ['primary', 'secondary', 'accent']) {
    assert.match(migration, new RegExp(`target_branding_${color}_color !~ '\\^#\\[0-9A-Fa-f\\]\\{6\\}\\$'`));
  }
  assert.match(app, /Stable logo URL/);
  assert.match(app, /Primary color/);
  assert.match(app, /Secondary color/);
  assert.match(app, /Accent color/);
});

test('Founding recognition is explicitly a controlled-Beta label and never a platform permission', () => {
  assert.match(migration, /'Controlled Beta · Founding recognition'/);
  assert.match(migration, /'recognition_label', beta_recognition_label/);
  assert.match(app, /Founding recognition/);
  assert.doesNotMatch(migration, /FOUNDING[\s\S]{0,500}platform\.admin/);
});

test('Arctic Foxes data is never selected, modified, or seeded by onboarding', () => {
  assert.doesNotMatch(migration, /arctic foxes|arctic-foxes|2570ad07-af6b-44c0-92aa-25ea45697e5e/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b|\btruncate\b/i);
  assert.match(migration, /insert into public\.organizations/);
  assert.match(migration, /returning \* into workspace_organization/);
});
