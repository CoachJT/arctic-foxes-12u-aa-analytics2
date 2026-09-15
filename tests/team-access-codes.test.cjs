const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20260915000300_029_team_access_codes_and_join_requests.sql', 'utf8');

test('team access codes are stored only as hashes and support expiration/regeneration', () => {
  assert.match(sql, /code_hash text not null unique/);
  assert.match(sql, /expires_at timestamptz/);
  assert.match(sql, /revoked_at timestamptz/);
  assert.match(sql, /team_access_codes_one_live_per_team_idx/);
  assert.match(sql, /crypt\(normalized_code, gen_salt\('bf'\)\)/);
  assert.match(sql, /update public\.team_access_codes set revoked_at = now\(\)/);
});

test('access-code redemption only creates a pending request and prevents duplicates', () => {
  assert.match(sql, /status text not null default 'pending'/);
  assert.match(sql, /team_join_requests_one_pending_per_user_team_idx/);
  assert.match(sql, /on conflict \(team_id, requester_id\) where status = 'pending' do nothing/);
  assert.match(sql, /You already have a pending request for this team/);
  assert.doesNotMatch(sql.match(/create or replace function public\.request_team_access[\s\S]*?\n\$\$;/)?.[0] || '', /insert into public\.team_memberships/);
});

test('approval is limited to platform admins or team owners and grants only the requested team role', () => {
  assert.match(sql, /select public\.is_platform_admin\(\) or public\.is_team_owner\(target_team_id\)/);
  assert.match(sql, /if requested_role_input = 'owner'/);
  assert.match(sql, /requested_role_id <> 'owner'/);
  const decision = sql.split('create or replace function public.decide_team_join_request')[1] || '';
  assert.match(decision, /if not public\.can_manage_team_join_requests\(request_row\.team_id\)/);
  assert.match(decision, /role_id, status, invited_by/);
  assert.match(decision, /request_row\.requested_role_id/);
  assert.doesNotMatch(decision, /platform_admin/);
});

test('code and request tables are not directly exposed to anon or authenticated clients', () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.team_access_codes, public\.team_join_requests from anon/);
  assert.match(sql, /revoke all on public\.team_access_codes, public\.team_join_requests from authenticated/);
  assert.match(sql, /revoke all on function public\.(?:can_manage_team_join_requests|create_or_regenerate_team_access_code)/);
});
