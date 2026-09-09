-- PuckNexus controlled Beta onboarding.
-- Additive only: this migration creates no production organizations, teams,
-- seasons, memberships, entitlements, or invitations when applied.

insert into public.roles (id, label, description)
values
  ('head_coach', 'Head Coach', 'Team leadership and administrative access without platform administration.'),
  ('team_manager', 'Team Manager', 'Team operations access without owner or platform administration.'),
  ('video_coach', 'Video Coach', 'Game and video review access without team or platform administration.')
on conflict (id) do nothing;
insert into public.role_permissions (role_id, capability)
select 'head_coach', permission.capability
from public.role_permissions permission
where permission.role_id = 'owner'
on conflict do nothing;
insert into public.role_permissions (role_id, capability)
select 'team_manager', capability
from unnest(array[
  'dashboard.view', 'schedule.view', 'schedule.edit', 'players.view',
  'games.view', 'games.edit', 'reports.view', 'admin.users'
]::text[]) as capabilities(capability)
on conflict do nothing;
insert into public.role_permissions (role_id, capability)
select 'video_coach', capability
from unnest(array[
  'dashboard.view', 'games.view', 'scouting.view', 'reports.view'
]::text[]) as capabilities(capability)
on conflict do nothing;
create or replace function public.get_platform_authorization()
returns table (platform_admin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select public.is_platform_admin();
$$;
create or replace function public.beta_onboard_workspace(
  target_organization_name text,
  target_organization_slug text,
  target_team_name text,
  target_team_slug text,
  target_season_name text,
  target_season_key text,
  target_season_starts_on date,
  target_season_ends_on date,
  target_plan_id text,
  target_branding_display_name text,
  target_branding_short_name text,
  target_branding_logo_url text,
  target_branding_primary_color text,
  target_branding_secondary_color text,
  target_branding_accent_color text,
  target_coach_email text,
  target_coach_name text,
  target_coach_role_id text,
  target_token_hash text
)
returns table (
  organization_id uuid,
  team_id uuid,
  season_id uuid,
  plan_id text,
  invite_id uuid,
  invite_status text,
  recognition_label text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  normalized_email text := lower(trim(target_coach_email));
  normalized_plan_id text := upper(trim(target_plan_id));
  workspace_organization public.organizations%rowtype;
  workspace_team public.teams%rowtype;
  workspace_season public.seasons%rowtype;
  workspace_invite public.workspace_invites%rowtype;
  beta_recognition_label text;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required for Beta onboarding.';
  end if;

  if target_organization_name is null
     or length(trim(target_organization_name)) = 0
     or length(trim(target_organization_name)) > 120
     or target_organization_slug is null
     or target_organization_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or target_team_name is null
     or length(trim(target_team_name)) = 0
     or length(trim(target_team_name)) > 120
     or target_team_slug is null
     or target_team_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     or target_season_name is null
     or length(trim(target_season_name)) = 0
     or length(trim(target_season_name)) > 120
     or target_season_key is null
     or length(trim(target_season_key)) = 0
     or length(trim(target_season_key)) > 80 then
    raise exception 'Valid organization, team, and season details are required.';
  end if;

  if target_season_starts_on is null
     or target_season_ends_on is null
     or target_season_ends_on < target_season_starts_on then
    raise exception 'A valid season date range is required.';
  end if;

  if normalized_plan_id not in ('CORE', 'COACH', 'ELITE', 'FOUNDING', 'ORGANIZATION')
     or not exists (
       select 1
       from public.plan_catalog plan
       where plan.plan_id = normalized_plan_id
         and plan.status = 'active'
     ) then
    raise exception 'An active Beta plan is required.';
  end if;

  if target_branding_display_name is null
     or length(trim(target_branding_display_name)) = 0
     or length(trim(target_branding_display_name)) > 120
     or target_branding_short_name is null
     or length(trim(target_branding_short_name)) = 0
     or length(trim(target_branding_short_name)) > 32
     or target_branding_logo_url is null
     or target_branding_logo_url !~ '^https://'
     or length(target_branding_logo_url) > 2048
     or target_branding_primary_color is null
     or target_branding_primary_color !~ '^#[0-9A-Fa-f]{6}$'
     or target_branding_secondary_color is null
     or target_branding_secondary_color !~ '^#[0-9A-Fa-f]{6}$'
     or target_branding_accent_color is null
     or target_branding_accent_color !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Stable logo URL and valid branding colors are required.';
  end if;

  if normalized_email is null
     or normalized_email = ''
     or normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or target_coach_name is null
     or length(trim(target_coach_name)) = 0
     or length(trim(target_coach_name)) > 120
     or target_coach_role_id is null
     or target_coach_role_id not in ('owner', 'head_coach', 'assistant', 'team_manager', 'video_coach')
     or target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid first-coach invitation is required.';
  end if;

  insert into public.organizations (name, slug)
  values (trim(target_organization_name), target_organization_slug)
  returning * into workspace_organization;

  insert into public.teams (name, slug, organization_id)
  values (trim(target_team_name), target_team_slug, workspace_organization.id)
  returning * into workspace_team;

  insert into public.seasons (
    team_id, name, season_key, status, starts_on, ends_on
  )
  values (
    workspace_team.id, trim(target_season_name), trim(target_season_key),
    'active', target_season_starts_on, target_season_ends_on
  )
  returning * into workspace_season;

  update public.teams
  set default_season_id = workspace_season.id
  where id = workspace_team.id;

  insert into public.team_branding (
    team_id, display_name, short_name, logo_url, primary_color,
    secondary_color, accent_color, settings, updated_by
  )
  values (
    workspace_team.id, trim(target_branding_display_name),
    trim(target_branding_short_name), target_branding_logo_url,
    upper(target_branding_primary_color), upper(target_branding_secondary_color),
    upper(target_branding_accent_color),
    jsonb_build_object('onboarding', 'controlled_beta'),
    caller_id
  );

  beta_recognition_label := case normalized_plan_id
    when 'FOUNDING' then 'Controlled Beta · Founding recognition'
    else 'Controlled Beta'
  end;

  insert into public.organization_entitlements (
    organization_id, plan_id, status, metadata
  )
  values (
    workspace_organization.id, normalized_plan_id, 'active',
    jsonb_build_object(
      'source', 'beta_onboarding',
      'recognition_label', beta_recognition_label
    )
  );

  insert into public.workspace_invites (
    organization_id, team_id, season_id, role_id, plan_id, token_hash,
    email_normalized, display_name, invited_by, status, expires_at, metadata
  )
  values (
    workspace_organization.id, workspace_team.id, workspace_season.id,
    target_coach_role_id, normalized_plan_id, target_token_hash,
    normalized_email, trim(target_coach_name), caller_id, 'pending',
    now() + interval '72 hours',
    jsonb_build_object(
      'source', 'beta_onboarding',
      'delivery_state', 'pending_controlled_delivery',
      'recognition_label', beta_recognition_label
    )
  )
  returning * into workspace_invite;

  return query
  select
    workspace_organization.id,
    workspace_team.id,
    workspace_season.id,
    normalized_plan_id,
    workspace_invite.id,
    workspace_invite.status,
    beta_recognition_label;
end;
$$;
create or replace function public.revoke_beta_onboarding_invite(
  target_invite_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  existing_invite public.workspace_invites%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required to revoke a Beta onboarding invite.';
  end if;

  select *
  into existing_invite
  from public.workspace_invites invite
  where invite.id = target_invite_id
  for update;

  if not found
     or existing_invite.status <> 'pending'
     or existing_invite.metadata->>'source' <> 'beta_onboarding' then
    raise exception 'Only a pending Beta onboarding invite can be revoked.';
  end if;

  update public.workspace_invites
  set status = 'revoked',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('delivery_state', 'revoked')
  where id = existing_invite.id
    and status = 'pending';

  if not found then
    raise exception 'The Beta onboarding invite changed concurrently.';
  end if;

  return true;
end;
$$;
create or replace function public.reissue_beta_onboarding_invite(
  target_invite_id uuid,
  target_token_hash text
)
returns table (
  invite_id uuid,
  invite_status text,
  invite_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  existing_invite public.workspace_invites%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required to reissue a Beta onboarding invite.';
  end if;

  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid token hash is required.';
  end if;

  select *
  into existing_invite
  from public.workspace_invites invite
  where invite.id = target_invite_id
  for update;

  if not found
     or existing_invite.status <> 'pending'
     or existing_invite.metadata->>'source' <> 'beta_onboarding' then
    raise exception 'Only a pending Beta onboarding invite can be reissued.';
  end if;

  if exists (
    select 1
    from public.workspace_invites invite
    where invite.token_hash = target_token_hash
  ) then
    raise exception 'The invite token hash already exists.';
  end if;

  update public.workspace_invites
  set status = 'revoked',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('delivery_state', 'reissued')
  where id = existing_invite.id
    and status = 'pending';

  if not found then
    raise exception 'The Beta onboarding invite changed concurrently.';
  end if;

  return query
  insert into public.workspace_invites (
    organization_id, team_id, season_id, role_id, plan_id, token_hash,
    email_normalized, display_name, invited_by, status, expires_at, metadata
  )
  values (
    existing_invite.organization_id, existing_invite.team_id,
    existing_invite.season_id, existing_invite.role_id,
    existing_invite.plan_id, target_token_hash,
    existing_invite.email_normalized, existing_invite.display_name,
    caller_id, 'pending', now() + interval '72 hours',
    coalesce(existing_invite.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'delivery_state', 'pending_controlled_delivery',
        'reissued_from_invite_id', existing_invite.id
      )
  )
  returning id, status, expires_at;
end;
$$;
revoke all on function public.get_platform_authorization() from public, anon;
revoke all on function public.beta_onboard_workspace(
  text, text, text, text, text, text, date, date, text, text, text, text,
  text, text, text, text, text, text, text
) from public, anon;
revoke all on function public.revoke_beta_onboarding_invite(uuid) from public, anon;
revoke all on function public.reissue_beta_onboarding_invite(uuid, text) from public, anon;
grant execute on function public.get_platform_authorization() to authenticated;
grant execute on function public.beta_onboard_workspace(
  text, text, text, text, text, text, date, date, text, text, text, text,
  text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.revoke_beta_onboarding_invite(uuid) to authenticated;
grant execute on function public.reissue_beta_onboarding_invite(uuid, text) to authenticated;
do $$
begin
  if has_function_privilege('anon', 'public.get_platform_authorization()', 'execute')
     or has_function_privilege(
       'anon',
       'public.beta_onboard_workspace(text,text,text,text,text,text,date,date,text,text,text,text,text,text,text,text,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.revoke_beta_onboarding_invite(uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.reissue_beta_onboarding_invite(uuid,text)',
       'execute'
     ) then
    raise exception 'Anonymous Beta onboarding execution remains exposed.';
  end if;

  if exists (
    select 1
    from public.role_permissions permission
    where permission.capability = 'platform.admin'
  ) then
    raise exception 'Platform administration must not be granted through a team role.';
  end if;
end;
$$;
