const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql029 = fs.readFileSync('supabase/migrations/20260915040422_029_team_access_codes_and_join_requests.sql', 'utf8');
const sql030 = fs.readFileSync('supabase/migrations/20260915040423_030_platform_beta_usage_tracker.sql', 'utf8');
const sql031 = fs.readFileSync('supabase/migrations/20260915040424_031_private_team_film_clips_playlists.sql', 'utf8');

test('final access-code contract stores bcrypt verification and deterministic digest separately', () => {
  assert.match(sql029, /code_hash text not null,/);
  assert.match(sql029, /code_digest text not null,/);
  assert.match(sql029, /team_access_codes_active_digest_uidx/);
  assert.match(sql029, /expires_at timestamptz/);
  assert.match(sql029, /revoked_at timestamptz/);
  assert.match(sql029, /team_access_codes_one_live_per_team_idx/);
  assert.match(sql029, /crypt\(normalized_code, gen_salt\('bf'\)\)/);
  assert.match(sql029, /update public\.team_access_codes set revoked_at = now\(\)/);
});

test('access-code redemption only creates a pending request and prevents duplicates', () => {
  assert.match(sql029, /status text not null default 'pending'/);
  assert.match(sql029, /team_join_requests_one_pending_per_user_team_idx/);
  assert.match(sql029, /on conflict \(team_id, requester_id\) where status = 'pending'\s+do nothing/);
  assert.match(sql029, /You already have a pending request for this team/);
  assert.doesNotMatch(sql029.match(/create or replace function public\.request_team_access[\s\S]*?\n\$\$;/)?.[0] || '', /insert into public\.team_memberships/);
});

test('approval is limited to platform admins or team owners and grants only the requested team role', () => {
  assert.match(sql029, /select public\.is_platform_admin\(\) or public\.is_team_owner\(target_team_id\)/);
  assert.match(sql029, /if requested_role_input = 'owner'/);
  assert.match(sql029, /requested_role_id <> 'owner'/);
  const decision = sql029.split('create or replace function public.decide_team_join_request')[1] || '';
  assert.match(decision, /if not public\.can_manage_team_join_requests\(request_row\.team_id\)/);
  assert.match(decision, /role_id, status, invited_by/);
  assert.match(decision, /request_row\.requested_role_id/);
  assert.doesNotMatch(decision, /platform_admin/);
});

test('code and request tables are not directly exposed to anon or authenticated clients', () => {
  assert.match(sql029, /enable row level security/);
  assert.match(sql029, /revoke all on public\.team_access_codes, public\.team_join_requests from anon, authenticated/);
  assert.match(sql029, /revoke all on function public\.(?:can_manage_team_join_requests|create_or_regenerate_team_access_code)/);
});

test('final access-code migration enforces deterministic global collision prevention', () => {
  assert.match(sql029, /encode\(digest\(normalized_code, 'sha256'\), 'hex'\)/);
  assert.match(sql029, /This access code is already in use by another team/);
  assert.match(sql029, /code_digest = canonical_digest/);
  assert.match(sql029, /code_hash = crypt\(normalized_code, code_hash\)/);
});

test('final access-code migration preserves pending join dedupe and team isolation', () => {
  assert.match(sql029, /on conflict \(team_id, requester_id\) where status = 'pending'\s+do nothing/);
  assert.match(sql029, /You already have a pending request for this team/);
  assert.match(sql029, /You already have access to this team/);
  assert.match(sql029, /Choose a valid non-owner team role/);
  assert.match(sql029, /public\.can_manage_team_join_requests\(request_row\.team_id\)/);
  assert.match(sql029, /insert into public\.team_memberships/);
});

test('final beta usage migration uses deduplicated beta users and guarded aggregation', () => {
  assert.match(sql030, /public\.beta_usage_heartbeat\(\)/);
  assert.match(sql030, /t\.beta_status in \('beta_team', 'early_adopter'\)/);
  assert.match(sql030, /public\.admin_list_beta_usage\(\)/);
  assert.match(sql030, /public\.is_platform_admin\(\)/);
  assert.match(sql030, /from beta_users bu/);
});

test('final private film migration enforces same-team playlist clips via trigger validation', () => {
  assert.match(sql031, /function public\.validate_team_film_playlist_clip\(\)/);
  assert.match(sql031, /trigger team_film_playlist_clips_validate_same_team/);
  assert.match(sql031, /Cannot add clip from a different team to this playlist/);
  assert.match(sql031, /playlist_team_id <> clip_team_id/);
});

test('final private film migration enforces selected-staff sharing only to active same-team staff', () => {
  assert.match(sql031, /create table public\.team_film_playlist_shares/);
  assert.match(sql031, /function public\.validate_team_film_playlist_share\(\)/);
  assert.match(sql031, /trigger team_film_playlist_shares_validate_member/);
  assert.match(sql031, /Playlist can only be shared with active members of the same team/);
  assert.match(sql031, /m\.status = 'active'/);
});

test('final private film migration enforces RLS with NO platform admin bypass', () => {
  assert.match(sql031, /create policy team_film_select_for_members/);
  assert.match(sql031, /create policy team_film_clips_select_for_members/);
  assert.match(sql031, /create policy team_film_playlists_select_for_members/);
  assert.match(sql031, /create policy team_film_playlist_clips_select_for_members/);
  assert.match(sql031, /create policy team_film_playlist_shares_select_for_members/);
  assert.match(sql031, /public\.has_team_capability\(team_id, 'film\.view'\)/);
  assert.match(sql031, /public\.has_team_capability\(team_id, 'film\.edit'\)/);

  // Film is strictly private to team members; platform admins do NOT have automatic film bypass.
  assert.doesNotMatch(sql031, /is_platform_admin\(\)/);
  assert.doesNotMatch(sql031, /is_platform_founder\(\)/);
});
