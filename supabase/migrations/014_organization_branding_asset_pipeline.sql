-- Organization branding asset pipeline (hardened, revision 2).
-- Additive only. This migration is a proposal artifact: it is NOT applied to
-- production by this session. It implements the architecture reviewed in
-- ORGANIZATION_BRANDING_ASSET_PIPELINE.md with the following hardening:
--   * bucket provisioning fails closed instead of silently reconciling config
--   * the existing private-media storage INSERT policy is preserved verbatim
--     and only scoped away from the new public bucket, never weakened
--   * dedicated insert/delete (no update) policies for the new bucket, each
--     re-checking authorization directly in Storage, regardless of the
--     media_assets row already having been authorized at prepare time
--   * a single canonical authorization predicate,
--     public.can_manage_organization_branding(organization_id, team_id) =
--       is_platform_admin() OR has_org_role(org,'org_owner')
--       OR has_org_role(org,'org_admin') OR is_team_owner(team)
--     used verbatim in the prepare/finalize/delete RPCs AND in both
--     dedicated Storage policies, so authorization can never drift between
--     the two enforcement points
--   * a general, Stage-1.3-aligned platform_admins bootstrap table (not a
--     disconnected "branding admin" concept) backing is_platform_admin()
--   * server-generated, immutable object paths; the client never supplies a
--     path or a public URL
--   * finalize reconciles size/content-type against storage.objects metadata
--     on a best-effort basis, documented inline, and fails closed if the
--     uploaded object itself cannot be found, or if no server-controlled
--     absolute https base URL is configured -- it never falls back to a
--     root-relative URL
--   * replacing an asset for the same team + asset_key is atomic: the new
--     asset's "uploaded" status, its predecessor's "superseded" metadata
--     marker, and the team_branding pointer update all land in the same
--     transaction (the same function invocation) or none do
--   * deleting an asset only clears the live team_branding/settings pointer
--     when that pointer currently equals the deleted asset's OWN resolved
--     URL -- deleting a superseded/replaced asset never regresses a newer
--     asset's pointer to null
--   * team_branding.settings.feature_images is merged defensively so a
--     malformed existing value can never abort the update
--   * deletion uses controlled cleanup semantics: this migration never
--     deletes storage.objects rows/blobs itself inside the DB transaction;
--     it only marks metadata state = 'cleanup_eligible' and soft-deletes
--     the media_assets row (status stays within the existing pending /
--     uploaded / failed / deleted contract -- "superseded" and
--     "cleanup_eligible" are metadata-only markers, never fabricated status
--     values)

-- ---------------------------------------------------------------------------
-- 1. Bucket provisioning: fail closed, never silently reconcile.
-- ---------------------------------------------------------------------------
do $$
declare
  existing record;
  expected_mime_types text[] := array['image/png', 'image/jpeg', 'image/webp'];
begin
  select public, file_size_limit, allowed_mime_types
  into existing
  from storage.buckets
  where id = 'organization-branding';

  if not found then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('organization-branding', 'organization-branding', true, 10485760, expected_mime_types);
  else
    -- Never `on conflict ... do update`: an existing bucket with unexpected
    -- configuration is a sign someone else changed it out-of-band, and this
    -- migration must not silently paper over that by reasserting our values.
    if existing.public is distinct from true then
      raise exception 'organization-branding bucket exists but is not public; refusing to modify it.';
    end if;
    if existing.file_size_limit is distinct from 10485760 then
      raise exception 'organization-branding bucket exists with an unexpected file_size_limit; refusing to modify it.';
    end if;
    if existing.allowed_mime_types is distinct from expected_mime_types then
      raise exception 'organization-branding bucket exists with unexpected allowed_mime_types; refusing to modify it.';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Preserve the generic private-media INSERT predicate verbatim; only scope
--    it away from the new public bucket, which is governed by its own
--    dedicated policies below. No UPDATE/DELETE bypass is introduced, and
--    this policy gains no awareness of organization branding beyond the
--    bucket_id exclusion -- the generic policy can never be used to bypass
--    the dedicated authorization checks for the new bucket.
-- ---------------------------------------------------------------------------
drop policy if exists storage_objects_insert_private_media on storage.objects;
create policy storage_objects_insert_private_media
on storage.objects for insert to authenticated
with check (
  bucket_id <> 'organization-branding'
  and exists (
    select 1 from public.media_assets asset
    where asset.bucket_name = bucket_id
      and asset.object_path = name
      and asset.uploaded_by = (select auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- 3. Platform admin bootstrap -- general model aligned with the existing
--    Stage 1.3 'platform.admin' UI capability, not a disconnected
--    "platform-branding admin" concept.
--
--    Audit of the existing Stage 1.3 architecture (web/app.js,
--    hasPlatformAdminAuthorization(): `authCapabilities.includes
--    ('platform.admin')`) shows 'platform.admin' is only ever checked
--    against `effective_capabilities`, which
--    public.resolve_workspace_access() / public.list_authorized_workspaces()
--    (migration 009) derive solely from public.role_permissions rows for the
--    caller's per-team role. No 'platform.admin' capability is ever seeded
--    into public.role_permissions by any existing migration, and no
--    persistent, durable "platform admin" table exists anywhere in the
--    schema today -- the UI affordance currently has no real backing data.
--
--    Rather than inventing a bucket/feature-specific admin table, this
--    migration adds the minimal general-purpose table and helper the
--    'platform.admin' capability is missing, under a name that says what it
--    grants (platform administration in general) rather than what one
--    caller happens to use it for (branding). public.is_platform_admin() is
--    written so ANY future capability check -- branding or otherwise -- can
--    depend on the same source of truth.
--
--    This migration intentionally does NOT modify
--    resolve_workspace_access()/list_authorized_workspaces() to fold
--    is_platform_admin() into effective_capabilities: that would change the
--    return contract of an existing production RPC and deserves its own
--    reviewed, additive migration (e.g. appending 'platform.admin' to the
--    aggregated capability array via `... or public.is_platform_admin()`
--    style logic). Documented here as the natural follow-up, not implemented.
--
--    Row Level Security is enabled with only a select-self policy -- no
--    insert/update/delete policy exists at all, so no browser session (anon
--    or authenticated) can ever grant itself or anyone else this capability;
--    only a service-role migration or console action can. No one is
--    provisioned by this migration.
-- ---------------------------------------------------------------------------
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

create policy platform_admins_select_self
on public.platform_admins for select to authenticated
using (user_id = (select auth.uid()));

revoke all on public.platform_admins from anon, authenticated;
grant select on public.platform_admins to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins admin
    where admin.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 2 (continued). Single canonical authorization predicate shared verbatim by
--    the RPCs below AND the dedicated Storage policies in step 4, so the two
--    enforcement points can never drift apart. Exactly:
--      is_platform_admin() OR has_org_role(org,'org_owner')
--      OR has_org_role(org,'org_admin') OR is_team_owner(team)
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_organization_branding(
  target_organization_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.teams team
      where team.id = target_team_id
        and team.organization_id = target_organization_id
    )
    and (
      public.is_platform_admin()
      or public.has_org_role(target_organization_id, 'org_owner')
      or public.has_org_role(target_organization_id, 'org_admin')
      or public.is_team_owner(target_team_id)
    );
$$;

revoke all on function public.can_manage_organization_branding(uuid, uuid) from public, anon;
grant execute on function public.can_manage_organization_branding(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege dedicated policies for the new bucket. No update policy:
--    branding artwork is replaced by uploading a new immutable object, never
--    mutated in place. Public read does not require a select policy because
--    a public bucket is served by the Storage service without evaluating
--    storage.objects RLS; we intentionally do not add one.
--
--    Both policies call can_manage_organization_branding() directly against
--    the associated media_assets row's organization_id/team_id -- this is a
--    deliberate, redundant re-check performed in Storage itself, regardless
--    of the fact that the media_assets row could only have reached this
--    state via an already-authorized RPC call (prepare/finalize above). The
--    insert policy additionally keeps the pending-status and uploaded_by
--    checks, since the storage.upload() call is expected to come from the
--    same authenticated session that called prepare_organization_branding_
--    asset() and was assigned as uploaded_by at that time.
-- ---------------------------------------------------------------------------
create policy organization_branding_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'organization-branding'
  and exists (
    select 1 from public.media_assets asset
    where asset.bucket_name = bucket_id
      and asset.object_path = name
      and asset.asset_type = 'branding'
      and asset.status = 'pending'
      and asset.uploaded_by = (select auth.uid())
      and public.can_manage_organization_branding(asset.organization_id, asset.team_id)
  )
);

create policy organization_branding_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'organization-branding'
  and exists (
    select 1 from public.media_assets asset
    where asset.bucket_name = bucket_id
      and asset.object_path = name
      and asset.asset_type = 'branding'
      and asset.status = 'deleted'
      and asset.metadata->>'state' = 'cleanup_eligible'
      and public.can_manage_organization_branding(asset.organization_id, asset.team_id)
  )
);

-- ---------------------------------------------------------------------------
-- 5. Server-controlled absolute https base URL resolution. Deliberately a
--    dedicated setting (not reused from anything client-suppliable): ops
--    must configure it out-of-band, e.g.
--      alter database postgres
--      set app.settings.organization_branding_base_url = 'https://<project-ref>.supabase.co';
--    Fails closed (raises) when unset, empty, or not an absolute https URL --
--    it never degrades to a root-relative URL. Because this raises before
--    any caller does further work, and an unhandled exception inside a
--    plpgsql function aborts the enclosing transaction, any caller (finalize
--    or delete, below) that hits this exception leaves ALL of its own prior
--    writes within that same call rolled back -- the live pointer and every
--    media_assets row it touched are left exactly as they were.
-- ---------------------------------------------------------------------------
create or replace function public.organization_branding_object_url(object_path text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  base_url text;
begin
  base_url := nullif(rtrim(coalesce(current_setting('app.settings.organization_branding_base_url', true), ''), '/'), '');
  if base_url is null then
    raise exception 'A server-configured absolute base URL is required to resolve branding asset URLs.';
  end if;
  if base_url !~ '^https://' then
    raise exception 'The configured branding base URL must be an absolute https URL.';
  end if;
  return base_url || '/storage/v1/object/public/organization-branding/' || object_path;
end;
$$;

revoke all on function public.organization_branding_object_url(text) from public, anon;
grant execute on function public.organization_branding_object_url(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. team_branding.settings merge/read helpers.
--
--    apply_organization_branding_setting() performs an UNCONDITIONAL set --
--    it is only ever called by finalize, below, for the asset that just
--    became the newest upload for its asset_key, which always wins the
--    pointer regardless of what it previously held. Guards feature_images
--    defensively: if the existing value is missing or not a JSON object
--    (e.g. corrupted to an array, string, or null by some other write
--    path), it is discarded and replaced with {} rather than allowed to
--    abort the merge or propagate a malformed shape forward.
--
--    current_organization_branding_url() reads back whatever
--    apply_organization_branding_setting() would have written for a given
--    asset_key, so delete (below) can compare a specific asset's own
--    resolved URL against the live pointer before clearing it.
--
--    clear_organization_branding_setting_if_matches() only clears the
--    pointer when the live value is IDENTICAL to the caller-supplied
--    expected_url -- this is what guarantees that deleting an old,
--    already-replaced asset (A) never clears a newer asset's (B) live
--    pointer: A's own URL will not match B's URL, so the compare fails and
--    the clear is skipped.
-- ---------------------------------------------------------------------------
create or replace function public.apply_organization_branding_setting(
  target_team_id uuid,
  asset_key text,
  new_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_settings jsonb;
  features jsonb;
begin
  if asset_key not in ('logo', 'hero', 'welcome', 'secondary', 'wordmark', 'watermark', 'film', 'scouting', 'reports', 'development', 'coaching_tools') then
    raise exception 'Unsupported branding asset key.';
  end if;

  select settings into current_settings
  from public.team_branding
  where team_id = target_team_id
  for update;

  if not found then
    raise exception 'Branding settings were not found for the target team.';
  end if;

  if current_settings is null or jsonb_typeof(current_settings) <> 'object' then
    current_settings := '{}'::jsonb;
  end if;

  if asset_key = 'logo' then
    update public.team_branding
    set logo_url = new_url, updated_at = now(), updated_by = (select auth.uid())
    where team_id = target_team_id;
    return;
  end if;

  if asset_key in ('wordmark', 'watermark') then
    if new_url is null then
      current_settings := current_settings - (asset_key || '_url');
    else
      current_settings := jsonb_set(current_settings, array[asset_key || '_url'], to_jsonb(new_url), true);
    end if;
  elsif asset_key in ('film', 'scouting', 'reports', 'development', 'coaching_tools') then
    -- Only merge into feature_images when it is already a JSON object.
    features := current_settings->'feature_images';
    if features is null or jsonb_typeof(features) <> 'object' then
      features := '{}'::jsonb;
    end if;
    if new_url is null then
      features := features - asset_key;
    else
      features := jsonb_set(features, array[asset_key], to_jsonb(new_url), true);
    end if;
    current_settings := jsonb_set(current_settings, array['feature_images'], features, true);
  else
    -- hero, welcome, secondary
    if new_url is null then
      current_settings := current_settings - (asset_key || '_image_url');
    else
      current_settings := jsonb_set(current_settings, array[asset_key || '_image_url'], to_jsonb(new_url), true);
    end if;
  end if;

  update public.team_branding
  set settings = current_settings, updated_at = now(), updated_by = (select auth.uid())
  where team_id = target_team_id;
end;
$$;

revoke all on function public.apply_organization_branding_setting(uuid, text, text) from public, anon;
-- Only called from the security-definer RPCs in this migration, never
-- directly by clients.
revoke execute on function public.apply_organization_branding_setting(uuid, text, text) from authenticated;

create or replace function public.current_organization_branding_url(
  target_team_id uuid,
  asset_key text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when asset_key = 'logo' then team_branding.logo_url
    when asset_key in ('wordmark', 'watermark') then team_branding.settings->>(asset_key || '_url')
    when asset_key in ('film', 'scouting', 'reports', 'development', 'coaching_tools') then
      case
        when jsonb_typeof(team_branding.settings->'feature_images') = 'object'
          then team_branding.settings->'feature_images'->>asset_key
        else null
      end
    else team_branding.settings->>(asset_key || '_image_url')
  end
  from public.team_branding
  where team_branding.team_id = target_team_id;
$$;

revoke all on function public.current_organization_branding_url(uuid, text) from public, anon;
revoke execute on function public.current_organization_branding_url(uuid, text) from authenticated;

create or replace function public.clear_organization_branding_setting_if_matches(
  target_team_id uuid,
  asset_key text,
  expected_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_url text;
begin
  if expected_url is null then
    return false;
  end if;
  current_url := public.current_organization_branding_url(target_team_id, asset_key);
  if current_url is distinct from expected_url then
    return false;
  end if;
  perform public.apply_organization_branding_setting(target_team_id, asset_key, null);
  return true;
end;
$$;

revoke all on function public.clear_organization_branding_setting_if_matches(uuid, text, text) from public, anon;
revoke execute on function public.clear_organization_branding_setting_if_matches(uuid, text, text) from authenticated;

-- ---------------------------------------------------------------------------
-- 7. Prepare: authorize, validate, and mint a server-generated immutable path.
--    The client supplies no path and no filename; the server chooses the
--    extension from the validated MIME type and the object id from
--    gen_random_uuid().
-- ---------------------------------------------------------------------------
create or replace function public.prepare_organization_branding_asset(
  target_organization_id uuid,
  target_team_id uuid,
  requested_asset_key text,
  requested_mime_type text,
  requested_size_bytes bigint
)
returns table (asset_id uuid, bucket_name text, object_path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  extension text;
  computed_path text;
begin
  if requested_asset_key not in ('logo', 'hero', 'welcome', 'secondary', 'wordmark', 'watermark', 'film', 'scouting', 'reports', 'development', 'coaching_tools') then
    raise exception 'Unsupported branding asset key.';
  end if;

  extension := case requested_mime_type
    when 'image/png' then 'png'
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
    else null
  end;
  if extension is null then
    raise exception 'Branding artwork must be a PNG, JPEG, or WebP image.';
  end if;

  if requested_size_bytes is null or requested_size_bytes < 1 or requested_size_bytes > 10485760 then
    raise exception 'Branding artwork must be between 1 byte and 10 MB.';
  end if;

  if not exists (
    select 1 from public.teams team
    where team.id = target_team_id
      and team.organization_id = target_organization_id
  ) then
    raise exception 'The selected team and organization are not authorized.';
  end if;

  -- (2) Exact canonical authorization: platform admin, org owner, org admin,
  -- or team owner of this specific team.
  if not public.can_manage_organization_branding(target_organization_id, target_team_id) then
    raise exception 'Insufficient authority to manage this organization''s branding.';
  end if;

  computed_path := 'organizations/' || target_organization_id::text || '/' || requested_asset_key || '/' || new_id::text || '.' || extension;

  insert into public.media_assets (
    id, organization_id, team_id, uploaded_by, asset_type,
    bucket_name, object_path, original_filename, mime_type, size_bytes,
    status, metadata
  )
  values (
    new_id, target_organization_id, target_team_id, (select auth.uid()), 'branding',
    'organization-branding', computed_path, requested_asset_key, requested_mime_type, requested_size_bytes,
    'pending', jsonb_build_object('asset_key', requested_asset_key)
  );

  return query select new_id, 'organization-branding'::text, computed_path;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Finalize: never accepts a client-supplied public URL. Reconciles size
--    and content type against storage.objects where reliably available, and
--    fails closed if the uploaded object cannot be found at all, or if no
--    server-controlled absolute https base URL is configured. Replacing a
--    prior asset for the same team + asset_key is atomic: this asset's own
--    status flip to 'uploaded', its predecessor's 'superseded' metadata
--    marker, and the team_branding pointer update all happen inside this
--    single function invocation.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_organization_branding_asset(
  target_asset_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  asset record;
  storage_object record;
  actual_size bigint;
  actual_mime text;
  extension text;
  computed_url text;
  asset_key text;
begin
  select * into asset
  from public.media_assets
  where id = target_asset_id
    and bucket_name = 'organization-branding'
    and asset_type = 'branding'
    and status = 'pending';

  if not found then
    raise exception 'A pending branding upload was not found for this asset.';
  end if;

  if asset.uploaded_by <> (select auth.uid()) then
    raise exception 'Only the uploader may finalize this branding asset.';
  end if;

  if not exists (
    select 1 from public.teams team
    where team.id = asset.team_id and team.organization_id = asset.organization_id
  ) then
    raise exception 'The selected team and organization are not authorized.';
  end if;

  -- (2) Exact canonical authorization, identical to prepare/delete and to
  -- the dedicated Storage policies.
  if not public.can_manage_organization_branding(asset.organization_id, asset.team_id) then
    raise exception 'Insufficient authority to finalize this organization''s branding asset.';
  end if;

  -- The storage.objects row existing at all is the authoritative signal that
  -- the upload actually landed in the bucket; fail closed if it is absent.
  select * into storage_object
  from storage.objects
  where bucket_id = asset.bucket_name and name = asset.object_path;

  if not found then
    raise exception 'The branding upload was not found in storage.';
  end if;

  -- (4) Fail closed if no server-controlled absolute https base URL is
  -- configured, BEFORE any mutation below. This call raises rather than
  -- returning a root-relative/no-base URL; because an unhandled exception in
  -- plpgsql aborts the whole enclosing transaction, no media_assets row and
  -- no team_branding pointer touched by this function is left changed when
  -- this fails -- the previously "current" asset (if any) remains current.
  computed_url := public.organization_branding_object_url(asset.object_path);
  if computed_url !~ '^https://' then
    raise exception 'Resolved branding URL was not an absolute https URL.';
  end if;

  -- Its `metadata` jsonb (size/mimetype) is populated by the Storage service
  -- on upload but is best-effort: the exact keys and their presence are not
  -- guaranteed across every Supabase Storage version/configuration. When a
  -- field is missing we fall back to the value declared (and already
  -- bounds-checked) at prepare time rather than blocking finalize on an
  -- enrichment field we cannot reliably depend on.
  actual_size := coalesce((storage_object.metadata->>'size')::bigint, asset.size_bytes);
  actual_mime := coalesce(storage_object.metadata->>'mimetype', asset.mime_type);

  if actual_size < 1 or actual_size > 10485760 then
    raise exception 'Uploaded branding artwork exceeds the permitted size.';
  end if;

  if actual_mime not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'Uploaded branding artwork has an unsupported content type.';
  end if;

  extension := case actual_mime
    when 'image/png' then 'png'
    when 'image/jpeg' then 'jpg'
    when 'image/webp' then 'webp'
  end;
  if asset.object_path !~ ('\.' || extension || '$') then
    raise exception 'Uploaded branding artwork content type does not match the reserved path.';
  end if;

  asset_key := asset.metadata->>'asset_key';

  update public.media_assets
  set status = 'uploaded',
      mime_type = actual_mime,
      size_bytes = actual_size,
      updated_at = now()
  where id = target_asset_id;

  -- (5) Mark any previously "uploaded" sibling for the same team + asset_key
  -- as superseded. Status remains 'uploaded' (still valid per the existing
  -- check constraint); only metadata records the new state. This update,
  -- the row update above, and the pointer update below all execute inside
  -- this same function invocation/transaction -- atomic together.
  update public.media_assets
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('state', 'superseded'),
      updated_at = now()
  where team_id = asset.team_id
    and asset_type = 'branding'
    and bucket_name = 'organization-branding'
    and id <> asset.id
    and status = 'uploaded'
    and metadata->>'asset_key' = asset_key;

  perform public.apply_organization_branding_setting(asset.team_id, asset_key, computed_url);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Delete: controlled cleanup semantics. Never deletes the storage.objects
--    row/blob itself inside this transaction -- storage.objects rows are
--    metadata; only the Storage service's own delete path removes the
--    backing blob, and doing so synchronously here would let a mid-request
--    failure desync our metadata from a blob that was never actually
--    removed. This function only soft-deletes the media_assets row (status
--    stays within the existing pending/uploaded/failed/deleted contract) and
--    marks metadata.state = 'cleanup_eligible' for later out-of-band
--    reconciliation by the Storage service's own delete call (authorized by
--    the organization_branding_objects_delete policy above, against this
--    same media_assets row, regardless of call order).
--
--    (1) Only clears the live team_branding/settings pointer when it
--    currently equals THIS asset's own resolved URL -- deleting an asset
--    that a newer upload already superseded never regresses a newer
--    asset's live pointer to null.
-- ---------------------------------------------------------------------------
create or replace function public.delete_organization_branding_asset(
  target_organization_id uuid,
  target_team_id uuid,
  target_asset_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  asset record;
  asset_key text;
  own_url text;
begin
  select * into asset
  from public.media_assets
  where id = target_asset_id
    and organization_id = target_organization_id
    and team_id = target_team_id
    and asset_type = 'branding'
    and bucket_name = 'organization-branding'
    and status <> 'deleted';

  if not found then
    raise exception 'Branding asset was not found for the requested workspace.';
  end if;

  -- (2) Exact canonical authorization, identical to prepare/finalize and to
  -- the dedicated Storage policies.
  if not public.can_manage_organization_branding(target_organization_id, target_team_id) then
    raise exception 'Insufficient authority to delete this branding asset.';
  end if;

  asset_key := asset.metadata->>'asset_key';

  if asset.status = 'uploaded' then
    own_url := public.organization_branding_object_url(asset.object_path);
    perform public.clear_organization_branding_setting_if_matches(target_team_id, asset_key, own_url);
  end if;

  update public.media_assets
  set status = 'deleted',
      deleted_at = now(),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('state', 'cleanup_eligible')
  where id = target_asset_id;

  return true;
end;
$$;

revoke all on function public.prepare_organization_branding_asset(uuid, uuid, text, text, bigint) from public, anon;
revoke all on function public.finalize_organization_branding_asset(uuid) from public, anon;
revoke all on function public.delete_organization_branding_asset(uuid, uuid, uuid) from public, anon;
grant execute on function public.prepare_organization_branding_asset(uuid, uuid, text, text, bigint) to authenticated;
grant execute on function public.finalize_organization_branding_asset(uuid) to authenticated;
grant execute on function public.delete_organization_branding_asset(uuid, uuid, uuid) to authenticated;
