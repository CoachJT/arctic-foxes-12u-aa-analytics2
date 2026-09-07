'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '008_entitlement_and_pending_invites.sql'),
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

test('Stage B migration is additive and contains no destructive SQL', () => {
  assert.doesNotMatch(migration, /\bdrop\s+(table|column|function|policy|trigger|index)\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /\bupdate\s+public\.(teams|seasons|team_memberships|roles|profiles)\b/i);
});

test('all Stage B catalog and entitlement tables are created', () => {
  for (const tableName of [
    'plan_catalog',
    'feature_catalog',
    'plan_feature_entitlements',
    'organization_entitlements',
    'team_membership_entitlements',
    'workspace_invites'
  ]) {
    assert.match(migration, new RegExp(`create table public\\.${tableName}`));
    assert.match(migration, new RegExp(`alter table public\\.${tableName} enable row level security`));
  }
});

test('all supported plan identifiers are seeded', () => {
  for (const planId of ['FOUNDING', 'CORE', 'COACH', 'ELITE', 'ORGANIZATION']) {
    assert.match(migration, new RegExp(`'${planId}'`));
  }
});

test('current and future-facing feature catalog entries are registered', () => {
  for (const featureKey of [
    'dashboard',
    'schedule',
    'stats',
    'players',
    'games',
    'scouting',
    'reports',
    'goalie_analytics',
    'admin',
    'backup_restore',
    'release_management',
    'seasons',
    'film',
    'clips',
    'playlists',
    'chat',
    'notifications',
    'ai_analytics'
  ]) {
    assert.match(migration, new RegExp(`'${featureKey}'`));
  }
});

test('FOUNDING resolves active catalog features by default and supports explicit disablement', () => {
  assert.match(migration, /target_plan_id = 'FOUNDING'/);
  assert.match(migration, /feature\.status = 'active'/);
  assert.match(
    migration,
    /exists \([\s\S]*plan_feature_entitlements[\s\S]*entitlement\.enabled/
  );
});

test('normal plans use explicit feature entitlement rows', () => {
  assert.match(migration, /insert into public\.plan_feature_entitlements/);
  assert.match(migration, /'CORE'/);
  assert.match(migration, /'COACH'/);
  assert.match(migration, /'ELITE'/);
  assert.match(migration, /'ORGANIZATION'/);
  assert.match(migration, /else false/);
});

test('workspace plan resolution gives team membership entitlement precedence over organization entitlement', () => {
  assert.match(migration, /create or replace function public\.resolve_workspace_plan/);
  assert.match(migration, /from public\.team_membership_entitlements entitlement/);
  assert.match(migration, /from public\.organization_entitlements entitlement/);
  assert.match(migration, /select coalesce\(/);
  assert.match(migration, /membership\.status = 'active'/);
});

test('suspended and expired entitlements cannot resolve as active', () => {
  assert.match(migration, /entitlement\.status = 'active'/);
  assert.match(migration, /entitlement\.starts_at <= now\(\)/);
  assert.match(migration, /entitlement\.ends_at is null or entitlement\.ends_at > now\(\)/);
  assert.match(migration, /status in \('active', 'suspended', 'expired'\)/);
});

test('feature access intersects entitlement with database capability authorization', () => {
  assert.match(migration, /create or replace function public\.has_workspace_feature_access/);
  assert.match(migration, /public\.has_team_capability\(target_team_id, requested_capability\)/);
  assert.match(migration, /public\.plan_feature_enabled\(/);
});

test('workspace invites store only a hashed token and prevent replay-shaped duplicates', () => {
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /length\(token_hash\) >= 32/);
  assert.doesNotMatch(migration, /\braw_token\b|\binvite_token\b|\btoken text\b/i);
  assert.match(migration, /status in \('pending', 'accepted', 'expired', 'revoked'\)/);
  assert.match(migration, /status <> 'accepted'[\s\S]*accepted_by is not null/);
  assert.match(migration, /status = 'accepted'[\s\S]*accepted_by is null/);
});

test('workspace invite targets are constrained to the same organization and team season', () => {
  assert.match(migration, /create or replace function public\.validate_workspace_invite_target/);
  assert.match(migration, /team\.organization_id/);
  assert.match(migration, /season\.team_id/);
  assert.match(migration, /Invite team must belong to the invited organization/);
  assert.match(migration, /Invite season must belong to the invited team/);
  assert.match(migration, /create trigger workspace_invites_validate_target/);
});

test('workspace invites do not accept a client-supplied user identity', () => {
  assert.doesNotMatch(migration, /\buser_id\b[^,\n]*workspace_invites/i);
  assert.match(migration, /invited_by uuid not null references auth\.users/);
  assert.match(migration, /accepted_by uuid references auth\.users/);
});

test('Stage B indexes cover organization, team, user, status, expiry, plan, and token lookup', () => {
  for (const indexName of [
    'organization_entitlements_org_status_idx',
    'organization_entitlements_plan_idx',
    'team_membership_entitlements_team_user_status_idx',
    'team_membership_entitlements_user_status_idx',
    'team_membership_entitlements_plan_idx',
    'workspace_invites_org_status_idx',
    'workspace_invites_team_status_idx',
    'workspace_invites_invited_by_idx',
    'workspace_invites_plan_idx',
    'workspace_invites_expiry_idx',
    'workspace_invites_token_hash_idx'
  ]) {
    assert.match(migration, new RegExp(`create index ${indexName}`));
  }
});

test('new helper functions use fixed search paths and authenticated-only execution', () => {
  for (const functionName of [
    'resolve_workspace_plan',
    'plan_feature_enabled',
    'has_workspace_feature_access',
    'validate_workspace_invite_target'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}`));
    if (functionName !== 'validate_workspace_invite_target') {
      assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}`));
    }
  }
  assert.match(migration, /set search_path = public/g);
  assert.match(migration, /from public, anon/);
  assert.match(migration, /to authenticated/);
});

test('new RLS policies preserve organization and team isolation', () => {
  assert.match(migration, /organization_entitlements_select_for_org_members[\s\S]*public\.is_org_member/);
  assert.match(migration, /team_membership_entitlements_select_for_team_members[\s\S]*public\.is_team_member/);
  assert.match(migration, /workspace_invites_select_for_authorized_admins[\s\S]*public\.has_team_capability/);
  assert.match(migration, /workspace_invites_insert_for_authorized_admins[\s\S]*invited_by = \(select auth\.uid\(\)\)/);
  assert.match(migration, /revoke all on public\.plan_catalog/);
  assert.match(migration, /from anon/);
});

test('Stage B does not weaken Stage 1A or final-owner protections', () => {
  assert.match(identity, /team_memberships_prevent_final_owner_update/);
  assert.match(identity, /team_memberships_prevent_final_owner_delete/);
  assert.match(hardening, /prevent_final_owner_delete/);
  assert.match(hardening, /prevent_final_owner_loss/);
  assert.match(hardening, /rls_auto_enable/);
  assert.match(hardening, /set search_path = public/);
  assert.match(migration, /team_memberships_prevent_final_owner_update/);
  assert.match(migration, /team_memberships_prevent_final_owner_delete/);
});

test('runtime assertions preserve the existing Arctic Foxes team and season IDs', () => {
  assert.match(migration, /2570ad07-af6b-44c0-92aa-25ea45697e5e/);
  assert.match(migration, /af046a03-235e-4d97-8134-3601f1c0da10/);
  assert.match(migration, /has_table_privilege\('anon'/);
  assert.match(migration, /has_function_privilege\('anon'/);
});
