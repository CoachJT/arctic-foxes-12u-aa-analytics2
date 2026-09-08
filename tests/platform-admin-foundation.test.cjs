const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '021_platform_admin_operations.sql'), 'utf8');
const client = fs.readFileSync(path.join(root, 'web', 'platform-admin.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');

test('platform admin migration is additive and collision-free', () => {
  assert.match(migration, /badge_catalog/);
  assert.match(migration, /player_badge_assignments/);
  assert.match(migration, /platform_admin_audit_log/);
  assert.match(migration, /beta_feedback/);
  assert.match(migration, /is_platform_admin\(\)/);
  assert.match(migration, /admin_create_organization/);
  assert.match(migration, /admin_create_team/);
  assert.match(migration, /admin_create_season/);
  assert.match(migration, /admin_create_workspace_invite/);
  assert.match(migration, /admin_revoke_workspace_invite/);
  assert.match(migration, /admin_list_users/);
  assert.match(migration, /admin_list_invites/);
  assert.match(migration, /admin_list_team_stats/);
  assert.match(migration, /admin_search_players/);
  assert.match(migration, /admin_list_workspace_details/);
  assert.match(migration, /player_badge_assignments_idempotency_idx/);
});

test('automatic badges and stat corrections are server controlled', () => {
  assert.match(migration, /target_source = 'automatic'[\s\S]*platform_admin_required/);
  assert.match(migration, /Automatic badges cannot be manually forged/);
  assert.match(migration, /target_new_value::text ~\* 'inf\|nan'/);
  assert.match(migration, /valid team, season, game, and roster relationship/);
  assert.match(migration, /The organization plan does not allow additional teams/);
  assert.match(migration, /A pending invite already exists/);
  assert.match(migration, /badge\.scope = 'organization'/);
  assert.match(migration, /badge game is not part of the selected team season/);
  assert.match(migration, /admin_correct_player_stat/);
  assert.match(migration, /write_platform_admin_audit/);
  assert.match(migration, /before_snapshot/);
  assert.match(migration, /after_snapshot/);
  assert.match(migration, /revoke all on public\.platform_admin_audit_log/);
});

test('client boundary delegates to protected RPCs and is loaded', () => {
  for (const name of [
    'admin_create_organization',
    'admin_create_team',
    'admin_create_season',
    'admin_create_workspace_invite',
    'admin_revoke_workspace_invite',
    'admin_update_badge',
    'admin_list_users',
    'admin_list_invites',
    'admin_list_team_stats',
    'admin_search_players',
    'admin_list_workspace_details',
    'admin_create_badge',
    'admin_award_badge',
    'admin_correct_player_stat',
    'admin_correct_team_stat'
  ]) assert.match(client, new RegExp(name));
  assert.match(index, /platform-admin\.js/);
});
