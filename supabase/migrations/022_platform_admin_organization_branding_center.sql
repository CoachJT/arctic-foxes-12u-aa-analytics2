-- Platform Admin Organization Branding Center v1.
-- Additive contract: legacy team_branding write paths remain unchanged.
-- v1 deliberately preserves primary_color, secondary_color, accent_color,
-- tagline, motto, watermark_url, and all unrelated settings.

create table public.organization_branding_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  action text not null check (action in ('publish_config', 'publish_asset', 'remove_asset', 'reset', 'copy')),
  asset_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(asset_keys) = 'array'),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now(),
  constraint organization_branding_audit_team_fk
    foreign key (team_id)
    references public.teams (id)
);

create index organization_branding_audit_target_idx
  on public.organization_branding_audit_log (organization_id, team_id, created_at desc);

create index organization_branding_audit_actor_idx
  on public.organization_branding_audit_log (actor_user_id, created_at desc);

alter table public.organization_branding_audit_log enable row level security;
revoke all on public.organization_branding_audit_log from public, anon, authenticated;
grant select on public.organization_branding_audit_log to authenticated;

create policy organization_branding_audit_platform_admin_select
on public.organization_branding_audit_log for select to authenticated
using (public.is_platform_admin());

create or replace function public.platform_admin_branding_projection(target_team_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'logo_url', branding.logo_url,
    'wordmark_url', branding.settings->>'wordmark_url',
    'hero_image_url', branding.settings->>'hero_image_url',
    'welcome_image_url', branding.settings->>'welcome_image_url',
    'secondary_image_url', branding.settings->>'secondary_image_url',
    'feature_images', jsonb_build_object(
      'film', branding.settings->'feature_images'->'film',
      'scouting', branding.settings->'feature_images'->'scouting',
      'reports', branding.settings->'feature_images'->'reports',
      'development', branding.settings->'feature_images'->'development',
      'coaching_tools', branding.settings->'feature_images'->'coaching_tools'
    )
  )
  from public.team_branding branding
  where branding.team_id = target_team_id;
$$;

revoke all on function public.platform_admin_branding_projection(uuid) from public, anon;

create or replace function public.record_platform_admin_branding_audit(
  target_organization_id uuid,
  target_team_id uuid,
  target_action text,
  target_asset_keys jsonb,
  target_before_state jsonb,
  target_after_state jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email_value text;
begin
  select user_record.email into actor_email_value
  from auth.users user_record
  where user_record.id = (select auth.uid());

  insert into public.organization_branding_audit_log (
    actor_user_id, actor_email, organization_id, team_id, action,
    asset_keys, before_state, after_state
  )
  values (
    (select auth.uid()), actor_email_value, target_organization_id, target_team_id,
    target_action, coalesce(target_asset_keys, '[]'::jsonb),
    target_before_state, target_after_state
  );
end;
$$;

revoke all on function public.record_platform_admin_branding_audit(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;

create or replace function public.list_platform_admin_branding_targets()
returns table (
  organization_id uuid,
  organization_name text,
  team_id uuid,
  team_name text,
  branding jsonb,
  branding_status text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required.';
  end if;

  return query
  select organization.id, organization.name, team.id, team.name,
    public.platform_admin_branding_projection(team.id),
    case when branding.team_id is null then 'missing' else 'configured' end,
    branding.updated_at
  from public.organizations organization
  join public.teams team on team.organization_id = organization.id
  left join public.team_branding branding on branding.team_id = team.id
  order by organization.name, team.name;
end;
$$;

create or replace function public.update_platform_admin_team_branding(
  target_organization_id uuid,
  target_team_id uuid,
  branding_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before_state jsonb;
  after_state jsonb;
  current_settings jsonb;
  patch_key text;
  patch_value jsonb;
  features jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required.';
  end if;
  if jsonb_typeof(branding_patch) <> 'object' then
    raise exception 'Branding patch must be a JSON object.';
  end if;
  if not exists (
    select 1 from public.teams team
    where team.id = target_team_id and team.organization_id = target_organization_id
  ) then
    raise exception 'The selected team and organization do not match.';
  end if;

  select public.platform_admin_branding_projection(target_team_id)
    into before_state;
  select settings into current_settings
  from public.team_branding
  where team_id = target_team_id
  for update;
  if not found then
    raise exception 'Branding settings were not found for the target team.';
  end if;

  for patch_key, patch_value in
    select key, value from jsonb_each(branding_patch)
  loop
    if patch_key = 'logo_url' then
      if patch_value <> 'null'::jsonb and (jsonb_typeof(patch_value) <> 'string' or patch_value #>> '{}' !~ '^https://') then
        raise exception 'Branding URLs must be absolute https URLs or null.';
      end if;
      update public.team_branding set logo_url = nullif(patch_value #>> '{}', 'null'), updated_by = (select auth.uid()), updated_at = now()
      where team_id = target_team_id;
    elsif patch_key in ('wordmark_url', 'hero_image_url', 'welcome_image_url', 'secondary_image_url') then
      if patch_value <> 'null'::jsonb and (jsonb_typeof(patch_value) <> 'string' or patch_value #>> '{}' !~ '^https://') then
        raise exception 'Branding URLs must be absolute https URLs or null.';
      end if;
      current_settings := jsonb_set(current_settings, array[patch_key], patch_value, true);
    elsif patch_key = 'feature_images' and jsonb_typeof(patch_value) = 'object' then
      features := coalesce(current_settings->'feature_images', '{}'::jsonb);
      for patch_key, patch_value in select key, value from jsonb_each(patch_value)
      loop
        if patch_key not in ('film', 'scouting', 'reports', 'development', 'coaching_tools')
          or (patch_value <> 'null'::jsonb and (jsonb_typeof(patch_value) <> 'string' or patch_value #>> '{}' !~ '^https://')) then
          raise exception 'Unsupported branding key or URL.';
        end if;
        features := jsonb_set(features, array[patch_key], patch_value, true);
      end loop;
      current_settings := jsonb_set(current_settings, array['feature_images'], features, true);
    else
      raise exception 'Unsupported branding key.';
    end if;
  end loop;

  update public.team_branding
  set settings = current_settings, updated_by = (select auth.uid()), updated_at = now()
  where team_id = target_team_id;
  after_state := public.platform_admin_branding_projection(target_team_id);
  perform public.record_platform_admin_branding_audit(
    target_organization_id, target_team_id, 'publish_config',
    (select jsonb_agg(key) from jsonb_each(branding_patch)), before_state, after_state
  );
  return after_state;
end;
$$;

create or replace function public.reset_platform_admin_team_branding(
  target_organization_id uuid,
  target_team_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before_state jsonb;
  after_state jsonb;
  current_settings jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required.';
  end if;
  if not exists (
    select 1 from public.teams team
    where team.id = target_team_id and team.organization_id = target_organization_id
  ) then
    raise exception 'The selected team and organization do not match.';
  end if;
  before_state := public.platform_admin_branding_projection(target_team_id);
  select settings into current_settings from public.team_branding where team_id = target_team_id for update;
  update public.team_branding
  set logo_url = null,
      settings = current_settings
        - 'wordmark_url' - 'hero_image_url' - 'welcome_image_url' - 'secondary_image_url'
        || jsonb_build_object('feature_images', coalesce(current_settings->'feature_images', '{}'::jsonb)
          - 'film' - 'scouting' - 'reports' - 'development' - 'coaching_tools'),
      updated_by = (select auth.uid()), updated_at = now()
  where team_id = target_team_id;
  after_state := public.platform_admin_branding_projection(target_team_id);
  perform public.record_platform_admin_branding_audit(
    target_organization_id, target_team_id, 'reset',
    '["logo_url","wordmark_url","hero_image_url","welcome_image_url","secondary_image_url","feature_images.film","feature_images.scouting","feature_images.reports","feature_images.development","feature_images.coaching_tools"]'::jsonb,
    before_state, after_state
  );
  return after_state;
end;
$$;

create or replace function public.copy_platform_admin_team_branding(
  source_organization_id uuid,
  source_team_id uuid,
  destination_organization_id uuid,
  destination_team_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_state jsonb;
  before_state jsonb;
  after_state jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required.';
  end if;
  if source_organization_id is distinct from destination_organization_id then
    raise exception 'Branding can only be copied within one organization.';
  end if;
  if not exists (select 1 from public.teams where id = source_team_id and organization_id = source_organization_id)
    or not exists (select 1 from public.teams where id = destination_team_id and organization_id = destination_organization_id) then
    raise exception 'The selected team and organization do not match.';
  end if;
  source_state := public.platform_admin_branding_projection(source_team_id);
  before_state := public.platform_admin_branding_projection(destination_team_id);
  perform public.update_platform_admin_team_branding(
    destination_organization_id, destination_team_id,
    jsonb_build_object(
      'logo_url', source_state->'logo_url',
      'wordmark_url', source_state->'wordmark_url',
      'hero_image_url', source_state->'hero_image_url',
      'welcome_image_url', source_state->'welcome_image_url',
      'secondary_image_url', source_state->'secondary_image_url',
      'feature_images', source_state->'feature_images'
    )
  );
  after_state := public.platform_admin_branding_projection(destination_team_id);
  perform public.record_platform_admin_branding_audit(
    destination_organization_id, destination_team_id, 'copy',
    '["logo_url","wordmark_url","hero_image_url","welcome_image_url","secondary_image_url","feature_images"]'::jsonb,
    before_state, after_state
  );
  return after_state;
end;
$$;

create or replace function public.list_platform_admin_branding_audit(
  target_organization_id uuid default null,
  target_team_id uuid default null,
  result_limit integer default 100
)
returns setof public.organization_branding_audit_log
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required.';
  end if;
  if result_limit < 1 or result_limit > 500 then
    raise exception 'Audit result limit must be between 1 and 500.';
  end if;
  return query
    select audit.*
    from public.organization_branding_audit_log audit
    where (target_organization_id is null or audit.organization_id = target_organization_id)
      and (target_team_id is null or audit.team_id = target_team_id)
    order by audit.created_at desc
    limit result_limit;
end;
$$;

revoke all on function public.list_platform_admin_branding_targets() from public, anon;
revoke all on function public.update_platform_admin_team_branding(uuid, uuid, jsonb) from public, anon;
revoke all on function public.reset_platform_admin_team_branding(uuid, uuid) from public, anon;
revoke all on function public.copy_platform_admin_team_branding(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.list_platform_admin_branding_audit(uuid, uuid, integer) from public, anon;
grant execute on function public.list_platform_admin_branding_targets() to authenticated;
grant execute on function public.update_platform_admin_team_branding(uuid, uuid, jsonb) to authenticated;
grant execute on function public.reset_platform_admin_team_branding(uuid, uuid) to authenticated;
grant execute on function public.copy_platform_admin_team_branding(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.list_platform_admin_branding_audit(uuid, uuid, integer) to authenticated;

-- Existing upload/delete RPCs remain available to legacy authorized callers.
-- These transition triggers add an audit event in the same transaction without
-- changing their authorization or organization-scoped storage behavior.
create or replace function public.audit_organization_branding_asset_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_action text;
  current_state jsonb;
begin
  target_action := case
    when new.status = 'uploaded' and old.status is distinct from 'uploaded' then 'publish_asset'
    when new.status = 'deleted' and old.status is distinct from 'deleted' then 'remove_asset'
    else null
  end;
  if target_action is null
    or new.asset_type <> 'branding'
    or new.bucket_name <> 'organization-branding' then
    return new;
  end if;

  current_state := public.platform_admin_branding_projection(new.team_id);
  perform public.record_platform_admin_branding_audit(
    new.organization_id,
    new.team_id,
    target_action,
    jsonb_build_array(new.metadata->>'asset_key'),
    current_state,
    current_state
  );
  return new;
end;
$$;

revoke all on function public.audit_organization_branding_asset_transition() from public, anon, authenticated;

drop trigger if exists organization_branding_asset_audit_transition
  on public.media_assets;
create trigger organization_branding_asset_audit_transition
after update of status on public.media_assets
for each row
execute function public.audit_organization_branding_asset_transition();
