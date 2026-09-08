'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
