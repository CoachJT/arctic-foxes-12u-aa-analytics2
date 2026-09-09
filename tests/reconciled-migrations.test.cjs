const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const readMigration = name => fs.readFileSync(path.join(migrationsDir, name), 'utf8');
const admin = readMigration('20260909000100_020_reconciled_platform_admin_dashboard.sql');
const onboarding = readMigration('20260909000200_021_reconciled_self_service_onboarding.sql');
const reconciled = `${admin}\n${onboarding}`;

test('reconciled admin migration retains production platform administration', () => {
  assert.match(admin, /public\.platform_admins/);
  assert.match(admin, /public\.is_platform_admin\(\)/);
  assert.match(admin, /add column if not exists role text/i);
  assert.match(admin, /set role = 'platform_admin'\s+where role is null/i);
  assert.match(admin, /check \(role in \('founder', 'platform_admin'\)\)/i);
  assert.match(admin, /create or replace function public\.is_platform_founder\(\)/i);
  assert.match(admin, /platform_admin\.role = 'founder'/i);
  assert.match(admin, /array_agg\(platform_admin\.role order by platform_admin\.role\)/i);
  assert.doesNotMatch(admin, /create table public\.platform_roles/i);
  assert.doesNotMatch(admin, /create table public\.team_invitations/i);
  assert.doesNotMatch(admin, /admin_resend_invitation/i);
  assert.match(admin, /from public\.workspace_invites invite/);
  assert.doesNotMatch(admin, /invite\.token_hash/);
  assert.match(admin, /add column if not exists beta_status text not null default 'none'/i);
});

test('reconciled onboarding uses production identity, entitlement, and roster contracts', () => {
  assert.match(onboarding, /role_id,\s*\n\s*status/);
  assert.match(onboarding, /'org_owner'/);
  assert.match(onboarding, /'owner'/);
  assert.match(onboarding, /'CORE'/);
  assert.match(onboarding, /status\)\s*\n\s*values \(progress\.team_id, resolved_key, resolved_key, 'active'\)/);
  assert.match(onboarding, /first_name/);
  assert.match(onboarding, /last_name/);
  assert.match(onboarding, /player_type/);
  assert.match(onboarding, /status = 'active'/);
  assert.doesNotMatch(onboarding, /onboarding_invite_staff/i);
  assert.match(onboarding, /create or replace function public\.onboarding_list_invites\(\)/);
  assert.match(onboarding, /from public\.workspace_invites invite/);
  assert.doesNotMatch(onboarding, /team_invitations/i);
});

test('reconciled privileged functions retain narrow grants and fixed search paths', () => {
  const privilegedFunctions = [
    'admin_list_organizations',
    'admin_get_organization',
    'admin_list_teams',
    'admin_list_users',
    'admin_get_user',
    'admin_list_memberships',
    'admin_list_invitations',
    'admin_revoke_invitation',
    'admin_set_beta_status',
    'onboarding_ensure',
    'onboarding_create_organization',
    'onboarding_create_team',
    'onboarding_create_season',
    'onboarding_add_player',
    'onboarding_mark_step',
    'onboarding_complete',
    'onboarding_save_branding',
    'onboarding_list_invites',
    'admin_list_onboarding'
  ];

  for (const name of privilegedFunctions) {
    assert.match(reconciled, new RegExp(`function public\\.${name}\\([\\s\\S]*?security definer\\s+set search_path = public`, 'i'), name);
    assert.match(reconciled, new RegExp(`revoke all on function public\\.${name}\\(`, 'i'), `${name} revoke`);
  }

  assert.match(onboarding, /revoke all on public\.onboarding_progress from public, anon, authenticated/i);
  assert.match(onboarding, /grant select on public\.onboarding_progress to authenticated/i);
  assert.doesNotMatch(onboarding, /grant (?:select,\s*)?insert.*on public\.onboarding_progress to authenticated/i);
  assert.match(reconciled, /Direct workspace invite reads must remain unavailable to browser roles/i);
});
