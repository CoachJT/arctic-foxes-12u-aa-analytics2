-- PuckNexus 2.0 Stage C workspace access resolution.
-- Additive only: existing RLS policies, memberships, roles, and production
-- identifiers remain unchanged.

create index team_memberships_user_status_team_idx
  on public.team_memberships(user_id, status, team_id);

create or replace function public.resolve_workspace_access(
  target_organization_id uuid,
  target_team_id uuid,
  target_season_id uuid default null
)
returns table (
  organization_id uuid,
  organization_name text,
  team_id uuid,
  team_name text,
  season_id uuid,
  season_name text,
  membership_status text,
  role_id text,
  role_label text,
  effective_capabilities jsonb,
  plan_id text,
  effective_features jsonb,
  branding_display_name text,
  branding_short_name text,
  branding_logo_url text,
  branding_primary_color text,
  branding_secondary_color text,
  branding_accent_color text,
  authorized boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    organization.id,
    organization.name,
    team.id,
    team.name,
    season.id,
    season.name,
    membership.status,
    team_role.id,
    team_role.label,
    coalesce(
      (
        select jsonb_agg(permission.capability order by permission.capability)
        from public.role_permissions permission
        where permission.role_id = team_role.id
      ),
      '[]'::jsonb
    ),
    workspace_plan.plan_id,
    workspace_features.features,
    branding.display_name,
    branding.short_name,
    branding.logo_url,
    branding.primary_color,
    branding.secondary_color,
    branding.accent_color,
    true
  from public.organizations organization
  join public.organization_memberships organization_membership
    on organization_membership.organization_id = organization.id
   and organization_membership.user_id = (select auth.uid())
   and organization_membership.status = 'active'
  join public.teams team
    on team.id = target_team_id
   and team.organization_id = organization.id
  join public.team_memberships membership
    on membership.team_id = team.id
   and membership.user_id = (select auth.uid())
   and membership.status = 'active'
  join public.roles team_role
    on team_role.id = membership.role_id
  left join public.seasons season
    on season.id = coalesce(target_season_id, team.default_season_id)
   and season.team_id = team.id
  left join public.team_branding branding
    on branding.team_id = team.id
  cross join lateral (
    select public.resolve_workspace_plan(team.id) as plan_id
  ) workspace_plan
  cross join lateral (
    select coalesce(
      jsonb_agg(feature.feature_key order by feature.feature_key),
      '[]'::jsonb
    ) as features
    from public.feature_catalog feature
    where feature.status = 'active'
      and public.plan_feature_enabled(
        workspace_plan.plan_id,
        feature.feature_key
      )
  ) workspace_features
  where organization.id = target_organization_id
    and target_organization_id is not null
    and target_team_id is not null
    and (
      target_season_id is null
      or exists (
        select 1
        from public.seasons requested_season
        where requested_season.id = target_season_id
          and requested_season.team_id = team.id
      )
    );
$$;

create or replace function public.list_authorized_workspaces()
returns table (
  organization_id uuid,
  organization_name text,
  team_id uuid,
  team_name text,
  season_id uuid,
  season_name text,
  membership_status text,
  role_id text,
  role_label text,
  effective_capabilities jsonb,
  plan_id text,
  effective_features jsonb,
  branding_display_name text,
  branding_short_name text,
  branding_logo_url text,
  branding_primary_color text,
  branding_secondary_color text,
  branding_accent_color text,
  authorized boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select access.*
  from public.team_memberships membership
  join public.teams team
    on team.id = membership.team_id
  cross join lateral public.resolve_workspace_access(
    team.organization_id,
    team.id,
    null
  ) access
  where membership.user_id = (select auth.uid())
    and membership.status = 'active'
  order by access.organization_name, access.team_name;
$$;

create or replace function public.has_workspace_feature_access(
  target_team_id uuid,
  target_season_id uuid,
  requested_capability text,
  requested_feature_key text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      target_season_id is null
      or public.can_access_team_season(target_team_id, target_season_id)
    )
    and public.has_workspace_feature_access(
      target_team_id,
      requested_capability,
      requested_feature_key
    );
$$;

revoke all on function public.resolve_workspace_access(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.list_authorized_workspaces()
  from public, anon;
revoke all on function public.has_workspace_feature_access(uuid, uuid, text, text)
  from public, anon;

grant execute on function public.resolve_workspace_access(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.list_authorized_workspaces()
  to authenticated;
grant execute on function public.has_workspace_feature_access(uuid, uuid, text, text)
  to authenticated;

-- Runtime assertions preserve the Stage 1A/Stage B security boundary.
do $$
begin
  if has_function_privilege(
    'anon',
    'public.resolve_workspace_access(uuid,uuid,uuid)',
    'execute'
  )
  or has_function_privilege(
    'anon',
    'public.list_authorized_workspaces()',
    'execute'
  )
  or has_function_privilege(
    'anon',
    'public.has_workspace_feature_access(uuid,uuid,text,text)',
    'execute'
  ) then
    raise exception 'Anonymous execution remains granted to Stage C helpers.';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.resolve_workspace_access(uuid,uuid,uuid)',
    'execute'
  )
  or not has_function_privilege(
    'authenticated',
    'public.list_authorized_workspaces()',
    'execute'
  )
  or not has_function_privilege(
    'authenticated',
    'public.has_workspace_feature_access(uuid,uuid,text,text)',
    'execute'
  ) then
    raise exception 'Authenticated execution is missing for Stage C helpers.';
  end if;

  if has_function_privilege(
    'anon',
    'public.is_team_member(uuid)',
    'execute'
  )
  or has_function_privilege(
    'anon',
    'public.has_team_capability(uuid,text)',
    'execute'
  )
  or has_function_privilege(
    'anon',
    'public.is_team_owner(uuid)',
    'execute'
  ) then
    raise exception 'Stage 1A anonymous helper hardening was weakened.';
  end if;

  if has_function_privilege(
    'anon',
    'public.prevent_final_owner_loss()',
    'execute'
  )
  or has_function_privilege(
    'authenticated',
    'public.prevent_final_owner_loss()',
    'execute'
  )
  or has_function_privilege(
    'anon',
    'public.prevent_final_owner_delete()',
    'execute'
  )
  or has_function_privilege(
    'authenticated',
    'public.prevent_final_owner_delete()',
    'execute'
  ) then
    raise exception 'Final-owner trigger function execution was broadened.';
  end if;

  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename = 'teams'
      and policy.policyname = 'teams_select_for_members'
      and policy.qual like '%is_team_member%'
  ) then
    raise exception 'Team selection is no longer governed by team membership.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.team_memberships'::regclass
      and tgname = 'team_memberships_prevent_final_owner_update'
      and not tgisinternal
  ) or not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.team_memberships'::regclass
      and tgname = 'team_memberships_prevent_final_owner_delete'
      and not tgisinternal
  ) then
    raise exception 'Final-owner triggers are not attached.';
  end if;
end;
$$;
