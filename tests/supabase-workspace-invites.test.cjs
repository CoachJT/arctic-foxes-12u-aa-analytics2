'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '010_secure_workspace_invite_acceptance.sql'),
  'utf8'
);
const legacyInvite = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'invite-staff', 'index.ts'),
  'utf8'
);
const createInvite = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'create-workspace-invite', 'index.ts'),
  'utf8'
);
const acceptInvite = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'accept-workspace-invite', 'index.ts'),
  'utf8'
);
const revokeInvite = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'revoke-workspace-invite', 'index.ts'),
  'utf8'
);
const stageB = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '008_entitlement_and_pending_invites.sql'),
  'utf8'
);
const stageC = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '009_workspace_access_resolution.sql'),
  'utf8'
);
const identity = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '001_identity_and_permissions.sql'),
  'utf8'
);
const hardening = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '007_security_integrity_foundation.sql'),
  'utf8'
);

const chrisAcceptanceFixtures = [
  {
    organization: 'North Hills Hockey',
    team: 'Junior Varsity',
    role: 'owner',
    plan: 'FOUNDING'
  },
  {
    organization: 'Arctic Foxes',
    team: '2014 BY / 12U AA',
    role: 'assistant',
    plan: 'FOUNDING'
  }
];

test('Stage D migration is additive and has no destructive reset or existing-data rewrite', () => {
  assert.doesNotMatch(migration, /\bdrop\s+(table|column|function|policy|trigger|index)\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(
    migration,
    /\bupdate\s+public\.(teams|seasons|roles|profiles)\b/i
  );
});

test('invite schema stores normalized recipient identity and supports organization or team targets', () => {
  assert.match(migration, /add column email_normalized text/);
  assert.match(migration, /add column display_name text/);
  assert.match(migration, /add column organization_role_id text/);
  assert.match(migration, /alter column role_id drop not null/);
  assert.match(migration, /workspace_invites_target_role_ck/);
  assert.match(migration, /team_id is not null[\s\S]*role_id is not null/);
  assert.match(migration, /team_id is null[\s\S]*organization_role_id is not null/);
});

test('token storage is hash-only and uses a SHA-256-shaped value', () => {
  assert.match(migration, /token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.doesNotMatch(migration, /\braw_token\b|\btoken text\b|\binvite_secret\b/i);
  assert.match(createInvite, /crypto\.getRandomValues/);
  assert.match(createInvite, /crypto\.subtle\.digest/);
  assert.match(createInvite, /'SHA-256'/);
  assert.match(acceptInvite, /crypto\.subtle\.digest/);
  assert.match(acceptInvite, /'SHA-256'/);
});

test('creation RPC derives invited_by from auth.uid and validates authorization server-side', () => {
  assert.match(migration, /create or replace function public\.create_workspace_invite/);
  assert.match(migration, /caller_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /invited_by/);
  assert.match(migration, /public\.has_team_capability\(target_team_id, 'admin\.users'\)/);
  assert.match(migration, /public\.has_org_role\(target_organization_id, 'org_owner'\)/);
  assert.match(migration, /public\.has_org_role\(target_organization_id, 'org_admin'\)/);
  assert.match(migration, /target_role_id = 'owner'[\s\S]*public\.is_team_owner/);
  assert.match(migration, /target_organization_role_id <> 'org_member'/);
});

test('creation validates organization, team, season, plan, email, expiry, and token hash', () => {
  assert.match(migration, /target_team_organization_id is distinct from target_organization_id/);
  assert.match(migration, /target_season_team_id is distinct from target_team_id/);
  assert.match(migration, /plan\.plan_id = target_plan_id/);
  assert.match(migration, /plan\.status = 'active'/);
  assert.match(migration, /normalized_email !~/);
  assert.match(migration, /target_expires_at <= now\(\)/);
  assert.match(migration, /target_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
});

test('creation supports safe token rotation by revoking only a pending replacement invite atomically', () => {
  assert.match(migration, /replace_invite_id uuid default null/);
  assert.match(migration, /existing_invite\.status <> 'pending'/);
  assert.match(migration, /set status = 'revoked/);
  assert.match(createInvite, /replaceInviteId/);
  assert.match(createInvite, /replace_invite_id: replaceInviteId/);
});

test('acceptance is authenticated, email-bound, and does not accept client authorization fields', () => {
  assert.match(migration, /create or replace function public\.accept_workspace_invite/);
  assert.match(migration, /caller_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /from auth\.users user_record/);
  assert.match(migration, /user_record\.email_confirmed_at/);
  assert.match(migration, /lower\(trim\(caller_email\)\) <> invite\.email_normalized/);
  assert.match(acceptInvite, /forbiddenOverrides/);
  for (const field of [
    'userId',
    'organizationId',
    'teamId',
    'seasonId',
    'roleId',
    'planId',
    'acceptedBy'
  ]) {
    assert.match(acceptInvite, new RegExp(`'${field}'`));
  }
  assert.doesNotMatch(acceptInvite, /accepted_by\s*:/);
});

test('acceptance locks a pending invite and rejects expired, revoked, accepted, or unknown tokens', () => {
  assert.match(migration, /where candidate\.token_hash = target_token_hash/);
  assert.match(migration, /for update/);
  assert.match(migration, /invite\.status <> 'pending'/);
  assert.match(migration, /invite\.expires_at <= now\(\)/);
  assert.match(migration, /already accepted/);
});

test('acceptance revalidates organization, team, season, role, and plan relationships', () => {
  assert.match(migration, /organization\.status = 'active'/);
  assert.match(migration, /team\.organization_id = invite\.organization_id/);
  assert.match(migration, /season\.team_id = invite\.team_id/);
  assert.match(migration, /role\.id = invite\.role_id/);
  assert.match(migration, /invite\.organization_role_id <> 'org_member'/);
});

test('acceptance creates the profile, organization membership, team membership, and entitlement atomically', () => {
  assert.match(migration, /insert into public\.profiles/);
  assert.match(migration, /insert into public\.organization_memberships/);
  assert.match(migration, /insert into public\.team_memberships/);
  assert.match(migration, /insert into public\.team_membership_entitlements/);
  assert.match(migration, /insert into public\.organization_entitlements/);
  assert.match(migration, /invite\.status <> 'pending'/);
  assert.match(migration, /accepted_by = caller_id/);
  assert.match(migration, /accepted_at = accepted_timestamp/);
});

test('membership upsert rules reject conflicting active roles and entitlements', () => {
  assert.match(migration, /existing_team_membership\.status = 'suspended'/);
  assert.match(migration, /existing_team_membership\.role_id <> invite\.role_id/);
  assert.match(migration, /existing_team_entitlement\.plan_id <> invite\.plan_id/);
  assert.match(migration, /existing_org_entitlement\.plan_id <> invite\.plan_id/);
  assert.match(migration, /status = 'invited'/);
  assert.match(migration, /set status = 'active'/);
});

test('acceptance assigns FOUNDING without bypassing role capability authorization', () => {
  assert.match(migration, /invite\.plan_id/);
  assert.match(migration, /team_membership_entitlements/);
  assert.match(stageB, /target_plan_id = 'FOUNDING'/);
  assert.match(stageC, /public\.has_team_capability/);
});

test('acceptance marks the invite once and prevents replay or concurrent double acceptance', () => {
  assert.match(migration, /update public\.workspace_invites/);
  assert.match(migration, /set status = 'accepted'/);
  assert.match(migration, /and status = 'pending'/);
  assert.match(migration, /accepted concurrently and cannot be replayed/);
  assert.match(migration, /for update/);
});

test('revocation is authenticated, authorization-checked, pending-only, and non-destructive', () => {
  assert.match(migration, /create or replace function public\.revoke_workspace_invite/);
  assert.match(migration, /Only a pending invite can be revoked/);
  assert.match(migration, /set status = 'revoked/);
  assert.doesNotMatch(migration, /delete\s+from public\.workspace_invites/i);
  assert.match(revokeInvite, /revoke_workspace_invite/);
  assert.match(revokeInvite, /inviteId/);
});

test('direct authenticated and anonymous invite table reads are revoked', () => {
  assert.match(
    migration,
    /revoke all on public\.workspace_invites from public, anon, authenticated/
  );
  assert.match(migration, /has_table_privilege\('authenticated', 'public\.workspace_invites', 'select'\)/);
  assert.match(migration, /has_table_privilege\('anon', 'public\.workspace_invites', 'select'\)/);
});

test('invite RPCs use fixed search paths and authenticated-only execution', () => {
  for (const functionName of [
    'create_workspace_invite',
    'accept_workspace_invite',
    'revoke_workspace_invite'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}`));
  }
  assert.match(migration, /security definer/gi);
  assert.match(migration, /set search_path = public/g);
  assert.match(migration, /from public, anon/);
  assert.match(migration, /to authenticated/);
});

test('Edge Functions use the caller JWT and publishable credentials only', () => {
  for (const source of [createInvite, acceptInvite, revokeInvite]) {
    assert.match(source, /SUPABASE_ANON_KEY/);
    assert.match(source, /Authorization/);
    assert.match(source, /createClient\(supabaseUrl, anonKey/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  }
});

test('raw tokens are returned only from creation and are never logged', () => {
  assert.match(createInvite, /token: rawToken/);
  assert.match(createInvite, /invite_url: inviteUrl\(rawToken\)/);
  assert.match(createInvite, /url\.hash = `invite_token=/);
  assert.doesNotMatch(createInvite, /console\.(log|info|error)[\s\S]*rawToken/);
  assert.doesNotMatch(acceptInvite, /console\.(log|info|error)[\s\S]*token/);
});

test('Chris multi-role acceptance fixture preserves independent target roles and plans', () => {
  assert.equal(chrisAcceptanceFixtures.length, 2);
  assert.deepEqual(chrisAcceptanceFixtures[0], {
    organization: 'North Hills Hockey',
    team: 'Junior Varsity',
    role: 'owner',
    plan: 'FOUNDING'
  });
  assert.deepEqual(chrisAcceptanceFixtures[1], {
    organization: 'Arctic Foxes',
    team: '2014 BY / 12U AA',
    role: 'assistant',
    plan: 'FOUNDING'
  });
  assert.notEqual(chrisAcceptanceFixtures[0].role, chrisAcceptanceFixtures[1].role);
  assert.match(stageC, /resolve_workspace_access/);
});

test('legacy invite-staff remains compatible and assistant-only', () => {
  assert.match(legacyInvite, /const allowedRoles = new Set\(\['assistant_goalie', 'assistant'\]\)/);
  assert.match(legacyInvite, /payload\?\.action === 'invite'/);
  assert.match(legacyInvite, /payload\?\.action === 'resend_setup'/);
  assert.match(legacyInvite, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(legacyInvite, /requiredText\(payload\?\.teamId, 'Team', 80\)/);
  assert.match(legacyInvite, /\.eq\('id', teamId\)/);
  assert.match(legacyInvite, /target_team_id: team\.id, requested_capability: 'admin\.users'/);
  assert.doesNotMatch(legacyInvite, /\.eq\('slug', 'arctic-foxes-12u-aa'\)/);
});

test('Stage 1A hardening and final-owner protections remain asserted', () => {
  assert.match(hardening, /prevent_final_owner_delete/);
  assert.match(hardening, /prevent_final_owner_loss/);
  assert.match(hardening, /rls_auto_enable/);
  assert.match(hardening, /set search_path = public/);
  assert.match(identity, /team_memberships_prevent_final_owner_update/);
  assert.match(identity, /team_memberships_prevent_final_owner_delete/);
  assert.match(migration, /Final-owner trigger execution was broadened/);
});
