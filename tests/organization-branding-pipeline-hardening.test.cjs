const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/014_organization_branding_asset_pipeline.sql').replace(/\r\n/g, '\n');

test('organization-branding bucket provisioning fails closed and never reconciles via on conflict', () => {
  assert.match(migration, /select public, file_size_limit, allowed_mime_types[\s\S]*?from storage\.buckets[\s\S]*?where id = 'organization-branding'/);
  assert.match(migration, /if not found then[\s\S]*?insert into storage\.buckets/);
  assert.match(migration, /existing\.public is distinct from true[\s\S]*?raise exception/);
  assert.match(migration, /existing\.file_size_limit is distinct from 10485760[\s\S]*?raise exception/);
  assert.match(migration, /existing\.allowed_mime_types is distinct from expected_mime_types[\s\S]*?raise exception/);
  assert.match(migration, /expected_mime_types text\[\] := array\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.match(migration, /values \('organization-branding', 'organization-branding', true, 10485760, expected_mime_types\)/);
  assert.doesNotMatch(migration, /on conflict\s*\(id\)\s*do update/i);
});

test('the generic private-media storage INSERT predicate is preserved verbatim and only scoped away from the new bucket (generic policy cannot bypass)', () => {
  const productionPredicate = read('supabase/migrations/012_storage_and_support_foundation.sql').replace(/\r\n/g, '\n');
  assert.match(productionPredicate, /create policy storage_objects_insert_private_media\non storage\.objects for insert to authenticated\nwith check \(exists \(\n  select 1 from public\.media_assets asset\n  where asset\.bucket_name = bucket_id\n {4}and asset\.object_path = name\n {4}and asset\.uploaded_by = \(select auth\.uid\(\)\)\n\)\);/);

  assert.match(migration, /drop policy if exists storage_objects_insert_private_media on storage\.objects;/);
  assert.match(migration, /create policy storage_objects_insert_private_media\non storage\.objects for insert to authenticated\nwith check \(\n {2}bucket_id <> 'organization-branding'\n {2}and exists \(\n {4}select 1 from public\.media_assets asset\n {4}where asset\.bucket_name = bucket_id\n {6}and asset\.object_path = name\n {6}and asset\.uploaded_by = \(select auth\.uid\(\)\)\n {2}\)\n\);/);
  const insertPolicyOccurrences = (migration.match(/storage_objects_insert_private_media/g) || []).length;
  assert.equal(insertPolicyOccurrences, 2, 'expected exactly one drop + one create for storage_objects_insert_private_media, no other policy variants');

  // The generic policy's predicate body never references the new
  // authorization helper or asset_type='branding' -- it cannot be leveraged
  // to bypass the dedicated bucket policies.
  const genericPolicyMatch = migration.match(/create policy storage_objects_insert_private_media\n[\s\S]*?\n\);/);
  assert.ok(genericPolicyMatch, 'expected to find the generic policy body');
  assert.doesNotMatch(genericPolicyMatch[0], /can_manage_organization_branding|asset_type/);
});

test('a single canonical authorization predicate is used verbatim by the RPCs and both dedicated Storage policies', () => {
  assert.match(migration, /create or replace function public\.can_manage_organization_branding\(\s*\n\s*target_organization_id uuid,\s*\n\s*target_team_id uuid\s*\n\)/);
  assert.match(migration, /auth\.uid\(\) is not null/);
  assert.match(migration, /exists \(\s*\n\s*select 1\s*\n\s*from public\.teams team\s*\n\s*where team\.id = target_team_id\s*\n\s*and team\.organization_id = target_organization_id\s*\n\s*\)/);
  assert.match(migration, /public\.is_platform_admin\(\)\s*\n\s*or public\.has_org_role\(target_organization_id, 'org_owner'\)\s*\n\s*or public\.has_org_role\(target_organization_id, 'org_admin'\)\s*\n\s*or public\.is_team_owner\(target_team_id\)/);

  const usages = migration.match(/can_manage_organization_branding\(/g) || [];
  // definition + grant + revoke + prepare + finalize + delete + 2 storage
  // policies, some of which reference the function more than once (e.g. a
  // signature in a comment/header plus the call site) = 10.
  assert.equal(usages.length, 10, `expected can_manage_organization_branding referenced by definition, grants, prepare/finalize/delete, and both storage policies; found ${usages.length} occurrences`);

  assert.match(migration, /create policy organization_branding_objects_insert[\s\S]*?can_manage_organization_branding\(asset\.organization_id, asset\.team_id\)/);
  assert.match(migration, /create policy organization_branding_objects_delete[\s\S]*?can_manage_organization_branding\(asset\.organization_id, asset\.team_id\)/);
  assert.match(migration, /create or replace function public\.prepare_organization_branding_asset[\s\S]*?can_manage_organization_branding\(target_organization_id, target_team_id\)/);
  assert.match(migration, /create or replace function public\.finalize_organization_branding_asset[\s\S]*?can_manage_organization_branding\(asset\.organization_id, asset\.team_id\)/);
  assert.match(migration, /create or replace function public\.delete_organization_branding_asset[\s\S]*?can_manage_organization_branding\(target_organization_id, target_team_id\)/);
});

test('the new bucket gets dedicated least-privilege insert/delete policies and no update policy', () => {
  assert.match(migration, /create policy organization_branding_objects_insert\non storage\.objects for insert to authenticated/);
  assert.match(migration, /create policy organization_branding_objects_delete\non storage\.objects for delete to authenticated/);
  assert.doesNotMatch(migration, /on storage\.objects for update/i);
  assert.doesNotMatch(migration, /create policy organization_branding_objects_select/i);
});

test('the dedicated Storage delete policy only allows cleanup after the delete RPC marks the asset cleanup eligible', () => {
  const deletePolicy = migration.match(/create policy organization_branding_objects_delete\n[\s\S]*?\n\);/)[0];
  assert.match(deletePolicy, /asset\.status = 'deleted'/);
  assert.match(deletePolicy, /asset\.metadata->>'state' = 'cleanup_eligible'/);
  assert.match(deletePolicy, /public\.can_manage_organization_branding\(asset\.organization_id, asset\.team_id\)/);
});

test('media_assets rows use the actual asset_type/status contract (branding, pending/uploaded/deleted) with no fabricated status values', () => {
  assert.match(migration, /'branding', *$/m);
  assert.match(migration, /'pending', jsonb_build_object\('asset_key', requested_asset_key\)/);
  assert.match(migration, /set status = 'uploaded'/);
  assert.match(migration, /set status = 'deleted',/);
  // superseded/cleanup_eligible are metadata-only markers, never a `status` value.
  assert.doesNotMatch(migration, /status = 'superseded'/);
  assert.doesNotMatch(migration, /status = 'cleanup_eligible'/);
  assert.match(migration, /jsonb_build_object\('state', 'superseded'\)/);
  assert.match(migration, /jsonb_build_object\('state', 'cleanup_eligible'\)/);
});

test('object paths are minted server-side from gen_random_uuid and never accept a client path', () => {
  assert.match(migration, /new_id uuid := gen_random_uuid\(\)/);
  assert.match(migration, /computed_path := 'organizations\/' \|\| target_organization_id::text/);
  assert.doesNotMatch(migration, /requested_object_path|requested_path|client_path/i);
  assert.doesNotMatch(migration, /create or replace function public\.prepare_organization_branding_asset\([^)]*path/i);
});

test('finalize never accepts a client-supplied public URL and fails closed if storage.objects is missing', () => {
  assert.match(migration, /create or replace function public\.finalize_organization_branding_asset\(\s*target_asset_id uuid\s*\)/);
  assert.doesNotMatch(migration, /finalize_organization_branding_asset\([^)]*public_url/i);
  assert.match(migration, /select \* into storage_object\s*\n\s*from storage\.objects\s*\n\s*where bucket_id = asset\.bucket_name and name = asset\.object_path;/);
  assert.match(migration, /if not found then\s*\n\s*raise exception 'The branding upload was not found in storage\.';/);
  assert.match(migration, /actual_size := coalesce\(\(storage_object\.metadata->>'size'\)::bigint, asset\.size_bytes\)/);
  assert.match(migration, /actual_mime := coalesce\(storage_object\.metadata->>'mimetype', asset\.mime_type\)/);
});

test('finalize fails closed on a missing/relative/no-base URL and only accepts an absolute https URL, before any mutation', () => {
  assert.match(migration, /create or replace function public\.organization_branding_object_url\(object_path text\)/);
  assert.match(migration, /base_url := nullif\(rtrim\(coalesce\(current_setting\('app\.settings\.organization_branding_base_url', true\), ''\), '\/'\), ''\);/);
  assert.match(migration, /if base_url is null then\s*\n\s*raise exception 'A server-configured absolute base URL is required to resolve branding asset URLs\.';/);
  assert.match(migration, /if base_url !~ '\^https:\/\/' then\s*\n\s*raise exception 'The configured branding base URL must be an absolute https URL\.';/);
  assert.doesNotMatch(migration, /coalesce\(base_url, ''\)/, 'must not degrade to a root-relative URL when base_url is absent');

  // The URL is resolved (and can raise) before the finalize function performs
  // any `update public.media_assets` / pointer mutation.
  const finalizeBody = migration.match(/create or replace function public\.finalize_organization_branding_asset[\s\S]*?\n\$\$;/)[0];
  const resolveIndex = finalizeBody.indexOf('computed_url := public.organization_branding_object_url(');
  const firstUpdateIndex = finalizeBody.indexOf('update public.media_assets');
  const applyIndex = finalizeBody.indexOf('perform public.apply_organization_branding_setting(');
  assert.ok(resolveIndex > -1 && firstUpdateIndex > -1 && applyIndex > -1);
  assert.ok(resolveIndex < firstUpdateIndex, 'URL resolution (and its fail-closed check) must happen before the media_assets update');
  assert.ok(resolveIndex < applyIndex, 'URL resolution (and its fail-closed check) must happen before the pointer update');
  assert.match(finalizeBody, /if computed_url !~ '\^https:\/\/' then/);
});

test('replacing an asset for the same team + asset_key is atomic: new status, predecessor superseded marker, and pointer update all happen in one function', () => {
  const finalizeBody = migration.match(/create or replace function public\.finalize_organization_branding_asset[\s\S]*?\n\$\$;/)[0];
  assert.match(finalizeBody, /set status = 'uploaded',/);
  assert.match(finalizeBody, /set metadata = coalesce\(metadata, '\{\}'::jsonb\) \|\| jsonb_build_object\('state', 'superseded'\)/);
  assert.match(finalizeBody, /where team_id = asset\.team_id\s*\n\s*and asset_type = 'branding'\s*\n\s*and bucket_name = 'organization-branding'\s*\n\s*and id <> asset\.id\s*\n\s*and status = 'uploaded'\s*\n\s*and metadata->>'asset_key' = asset_key;/);
  assert.match(finalizeBody, /perform public\.apply_organization_branding_setting\(asset\.team_id, asset_key, computed_url\);/);
  // No nested BEGIN/COMMIT or dblink -- atomicity comes from all three writes
  // happening inside this single function invocation/transaction.
  assert.doesNotMatch(finalizeBody, /\bcommit\b|\bbegin\s*;/i);
});

test("deleting an asset only clears the live pointer when it currently equals that asset's own resolved URL (old A deletion does not clear newer B)", () => {
  assert.match(migration, /create or replace function public\.current_organization_branding_url/);
  assert.match(migration, /create or replace function public\.clear_organization_branding_setting_if_matches/);
  assert.match(migration, /current_url := public\.current_organization_branding_url\(target_team_id, asset_key\);\s*\n\s*if current_url is distinct from expected_url then\s*\n\s*return false;/);

  const deleteBody = migration.match(/create or replace function public\.delete_organization_branding_asset[\s\S]*?\n\$\$;/)[0];
  assert.match(deleteBody, /if asset\.status = 'uploaded' then\s*\n\s*own_url := public\.organization_branding_object_url\(asset\.object_path\);\s*\n\s*perform public\.clear_organization_branding_setting_if_matches\(target_team_id, asset_key, own_url\);/);
  // The guarded clear is conditioned on the asset's own resolved URL, not an
  // unconditional apply_organization_branding_setting(..., null) call.
  assert.doesNotMatch(deleteBody, /apply_organization_branding_setting\(target_team_id, asset_key, null\)/);
});

test('feature_images merges are guarded against a malformed existing value', () => {
  assert.match(migration, /features := current_settings->'feature_images';\s*\n\s*if features is null or jsonb_typeof\(features\) <> 'object' then\s*\n\s*features := '\{\}'::jsonb;/);
});

test('a general platform admin bootstrap exists (aligned with Stage 1.3 platform.admin, not a disconnected branding-only admin) with RLS and no browser-writable path, and no one is provisioned', () => {
  assert.match(migration, /create table public\.platform_admins/);
  assert.match(migration, /alter table public\.platform_admins enable row level security;/);
  assert.match(migration, /create policy platform_admins_select_self/);
  assert.doesNotMatch(migration, /on public\.platform_admins for insert/i);
  assert.doesNotMatch(migration, /on public\.platform_admins for update/i);
  assert.doesNotMatch(migration, /on public\.platform_admins for delete/i);
  assert.doesNotMatch(migration, /insert into public\.platform_admins/i);
  // Not a disconnected, feature-specific concept: no "branding admin" table exists.
  assert.doesNotMatch(migration, /platform_branding_admin/i);
  // Documents the connection to the existing Stage 1.3 UI capability check.
  assert.match(migration, /'platform\.admin'/);
  assert.match(migration, /hasPlatformAdminAuthorization|effective_capabilities/);

  const app = read('web/app.js');
  assert.match(app, /authCapabilities\.includes\('platform\.admin'\)/);
});

test('production media_assets keeps no direct INSERT policy (writes only via SECURITY DEFINER RPCs), and this migration does not add one', () => {
  const productionStorage = read('supabase/migrations/012_storage_and_support_foundation.sql').replace(/\r\n/g, '\n');
  const stageG = read('supabase/migrations/013_stage_g_storage_isolation.sql').replace(/\r\n/g, '\n');
  assert.doesNotMatch(productionStorage, /on public\.media_assets for insert/i);
  assert.doesNotMatch(stageG, /on public\.media_assets for insert/i);
  assert.doesNotMatch(migration, /on public\.media_assets for insert/i);
  assert.doesNotMatch(migration, /on public\.media_assets for update/i);
  assert.doesNotMatch(migration, /on public\.media_assets for delete/i);
});

test('the dedicated Storage insert policy re-checks can_manage_organization_branding directly, regardless of media_assets already being authorized at prepare time', () => {
  const insertPolicy = migration.match(/create policy organization_branding_objects_insert\n[\s\S]*?\n\);/)[0];
  assert.match(insertPolicy, /asset\.status = 'pending'/);
  assert.match(insertPolicy, /asset\.uploaded_by = \(select auth\.uid\(\)\)/);
  assert.match(insertPolicy, /public\.can_manage_organization_branding\(asset\.organization_id, asset\.team_id\)/);
});

test('delete uses controlled cleanup semantics and never deletes storage.objects rows itself', () => {
  assert.doesNotMatch(migration, /delete from storage\.objects/i);
  assert.match(migration, /update public\.media_assets\s*\n\s*set status = 'deleted',\s*\n\s*deleted_at = now\(\),\s*\n\s*updated_at = now\(\),\s*\n\s*metadata = coalesce\(metadata, '\{\}'::jsonb\) \|\| jsonb_build_object\('state', 'cleanup_eligible'\)/);
});

test('anonymous access to the new RPCs and admin table remains denied', () => {
  assert.match(migration, /revoke all on function public\.prepare_organization_branding_asset\(uuid, uuid, text, text, bigint\) from public, anon;/);
  assert.match(migration, /revoke all on function public\.finalize_organization_branding_asset\(uuid\) from public, anon;/);
  assert.match(migration, /revoke all on function public\.delete_organization_branding_asset\(uuid, uuid, uuid\) from public, anon;/);
  assert.match(migration, /revoke all on public\.platform_admins from anon, authenticated;/);
  assert.match(migration, /revoke all on function public\.can_manage_organization_branding\(uuid, uuid\) from public, anon;/);
  assert.match(migration, /revoke all on function public\.is_platform_admin\(\) from public, anon;/);
});

test('behavior contract: org owner/admin allow, team owner only own team, platform admin allows, ordinary coach/cross-tenant deny (documented via the canonical predicate)', () => {
  // org owner/admin allow
  assert.match(migration, /has_org_role\(target_organization_id, 'org_owner'\)/);
  assert.match(migration, /has_org_role\(target_organization_id, 'org_admin'\)/);
  // team owner only for the specific target team (not organization-wide)
  assert.match(migration, /is_team_owner\(target_team_id\)/);
  // platform admin allows regardless of org/team membership
  assert.match(migration, /public\.is_platform_admin\(\)/);
  // An ordinary coach (no org_owner/org_admin/team_owner/platform_admin) or a
  // cross-tenant caller is denied because can_manage_organization_branding()
  // is a strict OR of exactly these four checks -- there is no other path
  // that grants access anywhere prepare/finalize/delete or either storage
  // policy performs its authorization check.
  const authzSites = [
    /create or replace function public\.prepare_organization_branding_asset[\s\S]*?if not public\.can_manage_organization_branding\(target_organization_id, target_team_id\) then/,
    /create or replace function public\.finalize_organization_branding_asset[\s\S]*?if not public\.can_manage_organization_branding\(asset\.organization_id, asset\.team_id\) then/,
    /create or replace function public\.delete_organization_branding_asset[\s\S]*?if not public\.can_manage_organization_branding\(target_organization_id, target_team_id\) then/
  ];
  for (const pattern of authzSites) {
    assert.match(migration, pattern);
  }
});
