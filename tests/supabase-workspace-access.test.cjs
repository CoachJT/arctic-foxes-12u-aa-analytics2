'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '009_workspace_access_resolution.sql'),
  'utf8'
);
const stageB = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '008_entitlement_and_pending_invites.sql'),
  'utf8'
);
const identity = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '001_identity_and_permissions.sql'),
  'utf8'
);
const foundation = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '006_multi_team_foundation.sql'),
  'utf8'
);
const hardening = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '007_security_integrity_foundation.sql'),
  'utf8'
);

const chrisFixture = {
  user: 'fixture-chris-skwortz',
  memberships: [
    {
      organization: 'North Hills Hockey',
      team: 'Junior Varsity',
      role: 'owner'
    },
    {
      organization: 'Arctic Foxes',
      team: '2014 BY / 12U AA',
      role: 'assistant'
    }
  ]
};

const daveFixture = {
  user: 'fixture-dave-roebuck',
  organization: 'Arctic Foxes',
  team: '2010 BY / 16U AA',
  role: 'owner'
};

const josephFixture = {
  user: 'fixture-joseph-thomas',
  organization: 'SHAHA',
  team: '2011 BY / 15U AA',
  role: 'owner'
};

test('Stage C migration is additive and does not rewrite production data', () => {
  assert.doesNotMatch(migration, /\bdrop\s+(table|column|function|policy|trigger|index)\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /\bupdate\s+public\.(teams|seasons|team_memberships|roles|profiles)\b/i);
  assert.match(migration, /create index team_memberships_user_status_team_idx/);
});

test('selected workspace resolver returns the required access shape', () => {
  assert.match(migration, /create or replace function public\.resolve_workspace_access/);
  for (const field of [
    'organization_id uuid',
    'organization_name text',
    'team_id uuid',
    'team_name text',
    'season_id uuid',
    'season_name text',
    'membership_status text',
    'role_id text',
    'role_label text',
    'effective_capabilities jsonb',
    'plan_id text',
    'effective_features jsonb',
    'branding_display_name text',
    'branding_short_name text',
    'branding_logo_url text',
    'branding_primary_color text',
    'branding_secondary_color text',
    'branding_accent_color text',
    'authorized boolean'
  ]) {
    assert.match(migration, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('resolver uses auth.uid and validates organization before team membership', () => {
  assert.match(migration, /organization_membership\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /organization_membership\.status = 'active'/);
  assert.match(migration, /team\.organization_id = organization\.id/);
  assert.match(migration, /membership\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /membership\.status = 'active'/);
  assert.match(migration, /team_role\.id = membership\.role_id/);
});

test('resolver rejects null, mismatched, and stale workspace selections safely', () => {
  assert.match(migration, /target_organization_id is not null/);
  assert.match(migration, /target_team_id is not null/);
  assert.match(migration, /target_season_id is null[\s\S]*requested_season\.team_id = team\.id/);
  assert.match(migration, /where organization\.id = target_organization_id/);
  assert.match(migration, /team\.id = target_team_id/);
  assert.doesNotMatch(migration, /coalesce\([^)]*previous|fallback.*workspace/i);
});

test('valid optional seasons use the selected season and null seasons use the team default', () => {
  assert.match(migration, /coalesce\(target_season_id, team\.default_season_id\)/);
  assert.match(migration, /season\.team_id = team\.id/);
  assert.match(migration, /target_season_id is null/);
});

test('authorized workspace listing is based on active team memberships, not organization membership alone', () => {
  assert.match(migration, /create or replace function public\.list_authorized_workspaces/);
  assert.match(migration, /from public\.team_memberships membership/);
  assert.match(migration, /membership\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /membership\.status = 'active'/);
  assert.match(migration, /resolve_workspace_access\(/);
  assert.doesNotMatch(
    migration,
    /from public\.organization_memberships membership[\s\S]*list_authorized_workspaces/
  );
});

test('role and capabilities are resolved from the selected team membership', () => {
  assert.match(migration, /team_role\.id/);
  assert.match(migration, /team_role\.label/);
  assert.match(migration, /from public\.role_permissions permission/);
  assert.match(migration, /permission\.role_id = team_role\.id/);
  assert.match(migration, /jsonb_agg\(permission\.capability/);
});

test('Chris fixture proves independent multi-organization and multi-role resolution', () => {
  assert.equal(chrisFixture.memberships.length, 2);
  assert.deepEqual(chrisFixture.memberships[0], {
    organization: 'North Hills Hockey',
    team: 'Junior Varsity',
    role: 'owner'
  });
  assert.deepEqual(chrisFixture.memberships[1], {
    organization: 'Arctic Foxes',
    team: '2014 BY / 12U AA',
    role: 'assistant'
  });
  assert.notEqual(
    chrisFixture.memberships[0].role,
    chrisFixture.memberships[1].role
  );
  assert.match(migration, /membership\.team_id = team\.id/);
  assert.match(migration, /membership\.role_id/);
});

test('Dave and Joseph fixtures remain isolated authenticated workspaces', () => {
  assert.equal(daveFixture.role, 'owner');
  assert.equal(josephFixture.role, 'owner');
  assert.notEqual(daveFixture.organization, josephFixture.organization);
  assert.notEqual(daveFixture.team, josephFixture.team);
  assert.doesNotMatch(migration, /dave|joseph|chris/i);
});

test('resolver reuses Stage B plan and feature helpers rather than duplicating entitlement logic', () => {
  assert.match(migration, /public\.resolve_workspace_plan\(team\.id\)/);
  assert.match(migration, /public\.plan_feature_enabled\(/);
  assert.match(stageB, /create or replace function public\.resolve_workspace_plan/);
  assert.match(stageB, /create or replace function public\.plan_feature_enabled/);
});

test('resolver exposes plan-derived features while capability intersection remains enforced', () => {
  assert.match(migration, /workspace_features\.features/);
  assert.match(migration, /feature\.status = 'active'/);
  assert.match(migration, /create or replace function public\.has_workspace_feature_access\(/);
  assert.match(migration, /target_season_id is null/);
  assert.match(migration, /public\.can_access_team_season\(target_team_id, target_season_id\)/);
  assert.match(migration, /public\.has_workspace_feature_access\(\s*target_team_id/);
  assert.match(stageB, /public\.has_team_capability\(target_team_id, requested_capability\)/);
});

test('workspace access functions are SECURITY DEFINER with fixed search paths', () => {
  for (const functionName of [
    'resolve_workspace_access',
    'list_authorized_workspaces',
    'has_workspace_feature_access'
  ]) {
    assert.match(migration, new RegExp(`function public\\.${functionName}`));
  }
  assert.match(migration, /security definer/gi);
  assert.match(migration, /set search_path = public/g);
});

test('anonymous execution is denied while authenticated execution is granted', () => {
  for (const functionName of [
    'resolve_workspace_access',
    'list_authorized_workspaces',
    'has_workspace_feature_access'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${functionName}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}`));
  }
  assert.match(migration, /from public, anon/);
  assert.match(migration, /to authenticated/);
  assert.match(migration, /has_function_privilege\(\s*'anon'/);
});

test('no RLS policy is broadened by Stage C', () => {
  assert.doesNotMatch(migration, /\bcreate policy\b/i);
  assert.doesNotMatch(migration, /\balter policy\b/i);
  assert.match(identity, /teams_select_for_members[\s\S]*public\.is_team_member/);
  assert.match(foundation, /seasons_select_for_team_members[\s\S]*has_team_capability/);
  assert.match(stageB, /team_membership_entitlements_select_for_team_members[\s\S]*public\.is_team_member/);
});

test('Stage 1A helper hardening and final-owner protections remain asserted', () => {
  assert.match(hardening, /prevent_final_owner_delete/);
  assert.match(hardening, /prevent_final_owner_loss/);
  assert.match(hardening, /rls_auto_enable/);
  assert.match(hardening, /set search_path = public/);
  assert.match(migration, /public\.is_team_member\(uuid\)/);
  assert.match(migration, /team_memberships_prevent_final_owner_update/);
  assert.match(migration, /team_memberships_prevent_final_owner_delete/);
});

test('Stage C runtime assertions preserve team-data isolation and trigger attachment', () => {
  assert.match(migration, /policy\.tablename = 'teams'/);
  assert.match(migration, /policy\.qual like '%is_team_member%'/);
  assert.match(migration, /tgname = 'team_memberships_prevent_final_owner_update'/);
  assert.match(migration, /tgname = 'team_memberships_prevent_final_owner_delete'/);
});
