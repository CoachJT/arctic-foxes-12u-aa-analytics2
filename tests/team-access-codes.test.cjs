const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql029 = fs.readFileSync('supabase/migrations/20260915000300_029_team_access_codes_and_join_requests.sql', 'utf8');
const sql032 = fs.readFileSync('supabase/migrations/20260915000600_032_team_access_codes_and_join_requests.sql', 'utf8');
const sql033 = fs.readFileSync('supabase/migrations/20260915000700_033_platform_beta_usage_tracker.sql', 'utf8');
const sql034 = fs.readFileSync('supabase/migrations/20260915000800_034_private_team_film_clips_playlists.sql', 'utf8');

test('team access codes are stored only as hashes and support expiration/regeneration in 029', () => {
  assert.match(sql029, /code_hash text not null unique/);
  assert.match(sql029, /expires_at timestamptz/);
  assert.match(sql029, /revoked_at timestamptz/);
  assert.match(sql029, /team_access_codes_one_live_per_team_idx/);
  assert.match(sql029, /crypt\(normalized_code, gen_salt\('bf'\)\)/);
  assert.match(sql029, /update public\.team_access_codes set revoked_at = now\(\)/);
});

test('access-code redemption only creates a pending request and prevents duplicates in 029', () => {
  assert.match(sql029, /status text not null default 'pending'/);
  assert.match(sql029, /team_join_requests_one_pending_per_user_team_idx/);
  assert.match(sql029, /on conflict \(team_id, requester_id\) where status = 'pending'\s+do nothing/);
  assert.match(sql029, /You already have a pending request for this team/);
  assert.doesNotMatch(sql029.match(/create or replace function public\.request_team_access[\s\S]*?\n\$\$;/)?.[0] || '', /insert into public\.team_memberships/);
});

test('approval is limited to platform admins or team owners and grants only the requested team role in 029', () => {
  assert.match(sql029, /select public\.is_platform_admin\(\) or public\.is_team_owner\(target_team_id\)/);
  assert.match(sql029, /if requested_role_input = 'owner'/);
  assert.match(sql029, /requested_role_id <> 'owner'/);
  const decision = sql029.split('create or replace function public.decide_team_join_request')[1] || '';
  assert.match(decision, /if not public\.can_manage_team_join_requests\(request_row\.team_id\)/);
  assert.match(decision, /role_id, status, invited_by/);
  assert.match(decision, /request_row\.requested_role_id/);
  assert.doesNotMatch(decision, /platform_admin/);
});

test('code and request tables are not directly exposed to anon or authenticated clients in 029', () => {
  assert.match(sql029, /enable row level security/);
  assert.match(sql029, /revoke all on public\.team_access_codes, public\.team_join_requests from anon/);
  assert.match(sql029, /revoke all on public\.team_access_codes, public\.team_join_requests from authenticated/);
  assert.match(sql029, /revoke all on function public\.(?:can_manage_team_join_requests|create_or_regenerate_team_access_code)/);
});

test('migration 032 enforces deterministic global code collision prevention via canonical digest', () => {
  assert.match(sql032, /add column if not exists code_digest text/);
  assert.match(sql032, /where revoked_at is null\s+and code_digest is null/);
  assert.match(sql032, /Invalidate those legacy live codes/);
  assert.match(sql032, /create unique index if not exists team_access_codes_code_digest_uidx\s+on public\.team_access_codes\(code_digest\)\s+where revoked_at is null/);
  assert.match(sql032, /encode\(digest\(normalized_code, 'sha256'\), 'hex'\)/);
  assert.match(sql032, /This access code is already in use by another team/);
  assert.match(sql032, /code_digest = canonical_digest/);
  assert.match(sql032, /code_hash = crypt\(normalized_code, code_hash\)/);
});

test('migration 032 preserves duplicate pending join dedupe and team/org isolation', () => {
  assert.match(sql032, /on conflict \(team_id, requester_id\) where status = 'pending'\s+do nothing/);
  assert.match(sql032, /You already have a pending request for this team/);
  assert.match(sql032, /You already have access to this team/);
  assert.match(sql032, /Choose a valid non-owner team role/);
  assert.match(sql032, /public\.can_manage_team_join_requests\(request_row\.team_id\)/);
  assert.match(sql032, /insert into public\.team_memberships/);
  assert.match(sql032, /revoke all on function public\.create_or_regenerate_team_access_code/);
  assert.match(sql032, /revoke all on function public\.request_team_access/);
  assert.match(sql032, /revoke all on function public\.decide_team_join_request/);
});

test('migration 033 reconciles beta usage tracker with membership deduplication and guarded admin list', () => {
  assert.match(sql033, /public\.beta_usage_heartbeat\(\)/);
  assert.match(sql033, /t\.beta_status in \('beta_team', 'early_adopter'\)/);
  assert.match(sql033, /public\.admin_list_beta_usage\(\)/);
  assert.match(sql033, /public\.is_platform_admin\(\)/);
  assert.match(sql033, /from beta_users bu/);
  assert.match(sql033, /revoke all on function public\.beta_usage_heartbeat\(\) from public, anon/);
  assert.match(sql033, /revoke all on function public\.admin_list_beta_usage\(\) from public, anon/);
});

test('migration 034 enforces same-team playlist clips via trigger validation', () => {
  assert.match(sql034, /function public\.validate_team_film_playlist_clip\(\)/);
  assert.match(sql034, /trigger team_film_playlist_clips_validate_same_team/);
  assert.match(sql034, /Cannot add clip from a different team to this playlist/);
  assert.match(sql034, /playlist_team_id <> clip_team_id/);
});

test('migration 034 enforces selected-staff sharing only to active same-team staff', () => {
  assert.match(sql034, /table if not exists public\.team_film_playlist_shares/);
  assert.match(sql034, /function public\.validate_team_film_playlist_share\(\)/);
  assert.match(sql034, /trigger team_film_playlist_shares_validate_member/);
  assert.match(sql034, /Playlist can only be shared with active members of the same team/);
  assert.match(sql034, /m\.status = 'active'/);
});

test('migration 034 enforces private team film RLS policies with NO platform admin bypass', () => {
  assert.match(sql034, /create policy team_film_select_for_members/);
  assert.match(sql034, /create policy team_film_clips_select_for_members/);
  assert.match(sql034, /create policy team_film_playlists_select_for_members/);
  assert.match(sql034, /create policy team_film_playlist_clips_select_for_members/);
  assert.match(sql034, /create policy team_film_playlist_shares_select_for_members/);
  assert.match(sql034, /public\.has_team_capability\(team_id, 'film\.view'\)/);
  assert.match(sql034, /public\.has_team_capability\(team_id, 'film\.edit'\)/);

  // Film is strictly private to team members; platform admins do NOT have automatic film bypass.
  assert.doesNotMatch(sql034, /is_platform_admin\(\)/);
  assert.doesNotMatch(sql034, /is_platform_founder\(\)/);
});
