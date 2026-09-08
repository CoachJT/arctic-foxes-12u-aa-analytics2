const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/022_platform_admin_organization_branding_center.sql'),
  'utf8'
).replace(/\r\n/g, '\n');
const legacy = fs.readFileSync(
  path.join(root, 'supabase/migrations/014_organization_branding_asset_pipeline.sql'),
  'utf8'
).replace(/\r\n/g, '\n');

test('branding center migration creates a dedicated, platform-admin-readable audit table', () => {
  assert.match(migration, /create table public\.organization_branding_audit_log/);
  assert.match(migration, /alter table public\.organization_branding_audit_log enable row level security/);
  assert.match(migration, /using \(public\.is_platform_admin\(\)\)/);
  assert.match(migration, /revoke all on public\.organization_branding_audit_log from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy.*organization_branding_audit_log.*for (insert|update|delete)/i);
});

test('all management RPCs require platform admin authorization and explicit target pairing', () => {
  for (const name of [
    'list_platform_admin_branding_targets',
    'update_platform_admin_team_branding',
    'reset_platform_admin_team_branding',
    'copy_platform_admin_team_branding',
    'list_platform_admin_branding_audit'
  ]) {
    const body = migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\n\\$\\$;`))?.[0];
    assert.ok(body, `missing ${name}`);
    assert.match(body, /public\.is_platform_admin\(\)/);
    assert.match(body, /set search_path = public/);
  }
  assert.match(migration, /team\.id = target_team_id and team\.organization_id = target_organization_id/);
  assert.match(migration, /source_organization_id is distinct from destination_organization_id/);
});

test('approved image keys are the only update/reset/copy surface and unrelated settings are preserved', () => {
  for (const key of ['logo_url', 'wordmark_url', 'hero_image_url', 'welcome_image_url', 'secondary_image_url', 'film', 'scouting', 'reports', 'development', 'coaching_tools']) {
    assert.match(migration, new RegExp(key));
  }
  assert.match(migration, /Unsupported branding key/);
  assert.match(migration, /primary_color|secondary_color|accent_color/);
  assert.match(migration, /- 'wordmark_url' - 'hero_image_url' - 'welcome_image_url' - 'secondary_image_url'/);
  assert.doesNotMatch(migration, /delete from storage\.objects/i);
});

test('audit captures actor identity, before/after projections, and stable actions', () => {
  assert.match(migration, /select user_record\.email into actor_email_value/);
  for (const action of ['publish_config', 'publish_asset', 'remove_asset', 'reset', 'copy']) {
    assert.match(migration, new RegExp(`'${action}'`));
  }
  assert.match(migration, /record_platform_admin_branding_audit/);
  assert.match(migration, /before_state/);
  assert.match(migration, /after_state/);
});

test('legacy asset pipeline permissions and organization-scoped storage behavior remain intact', () => {
  assert.match(legacy, /can_manage_organization_branding/);
  assert.match(legacy, /organizations\/' \|\| target_organization_id::text/);
  assert.match(legacy, /grant execute on function public\.finalize_organization_branding_asset/);
  assert.match(legacy, /grant execute on function public\.delete_organization_branding_asset/);
  assert.doesNotMatch(migration, /revoke all on public\.team_branding/);
  assert.doesNotMatch(migration, /drop policy.*team_branding.*update/i);
});
