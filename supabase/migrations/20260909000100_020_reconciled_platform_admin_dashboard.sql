-- Forward-only reconciliation after production ledger 019.
-- Platform administration remains exclusively controlled by
-- public.platform_admins. Its role is the authoritative source for the
-- platform_admin and founder release semantics.

alter table public.platform_admins
  add column if not exists role text;

update public.platform_admins
set role = 'platform_admin'
where role is null;

alter table public.platform_admins
  alter column role set default 'platform_admin',
  alter column role set not null;

alter table public.organizations
  add column if not exists beta_status text not null default 'none';

alter table public.teams
  add column if not exists beta_status text not null default 'none';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.platform_admins'::regclass
      and conname = 'platform_admins_role_check'
  ) then
    alter table public.platform_admins
      add constraint platform_admins_role_check
      check (role in ('founder', 'platform_admin'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.organizations'::regclass
      and conname = 'organizations_beta_status_check'
  ) then
    alter table public.organizations
      add constraint organizations_beta_status_check
      check (beta_status in ('none', 'beta_team', 'early_adopter'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.teams'::regclass
      and conname = 'teams_beta_status_check'
  ) then
    alter table public.teams
      add constraint teams_beta_status_check
      check (beta_status in ('none', 'beta_team', 'early_adopter'));
  end if;
end;
$$;

create or replace function public.is_platform_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.platform_admins platform_admin
      where platform_admin.user_id = (select auth.uid())
        and platform_admin.role = 'founder'
    );
$$;

create or replace function public.admin_list_organizations()
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  beta_status text,
  created_at timestamptz,
  team_count bigint,
  member_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    organization.id,
    organization.name,
    organization.slug,
    organization.status,
    organization.beta_status,
    organization.created_at,
    (select count(*) from public.teams team where team.organization_id = organization.id),
    (select count(*) from public.organization_memberships membership where membership.organization_id = organization.id)
  from public.organizations organization
  where (select auth.uid()) is not null
    and public.is_platform_admin()
  order by organization.created_at desc;
$$;

create or replace function public.admin_get_organization(target_organization_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
  status text,
  beta_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    organization.id,
    organization.name,
    organization.slug,
    organization.status,
    organization.beta_status,
    organization.created_at
  from public.organizations organization
  where organization.id = target_organization_id
    and (select auth.uid()) is not null
    and public.is_platform_admin();
$$;

create or replace function public.admin_list_teams(target_organization_id uuid default null)
returns table (
  id uuid,
  name text,
  slug text,
  organization_id uuid,
  organization_name text,
  default_season_id uuid,
  default_season_key text,
  beta_status text,
  created_at timestamptz,
  member_count bigint,
  pending_invite_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    team.id,
    team.name,
    team.slug,
    team.organization_id,
    organization.name,
    team.default_season_id,
    season.season_key,
    team.beta_status,
    team.created_at,
    (select count(*) from public.team_memberships membership where membership.team_id = team.id),
    (
      select count(*)
      from public.workspace_invites invite
      where invite.team_id = team.id
        and invite.status = 'pending'
        and (invite.expires_at is null or invite.expires_at > now())
    )
  from public.teams team
  join public.organizations organization on organization.id = team.organization_id
  left join public.seasons season on season.id = team.default_season_id
  where (target_organization_id is null or team.organization_id = target_organization_id)
    and (select auth.uid()) is not null
    and public.is_platform_admin()
  order by organization.name, team.name;
$$;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  display_name text,
  platform_roles text[],
  organization_memberships jsonb,
  team_memberships jsonb,
  pending_invitations bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    profile.id,
    profile.display_name,
    coalesce((
      select array_agg(platform_admin.role order by platform_admin.role)
      from public.platform_admins platform_admin
      where platform_admin.user_id = profile.id
    ), '{}'::text[]),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'organization_id', membership.organization_id,
        'organization_name', organization.name,
        'role', membership.role_id,
        'status', membership.status
      ) order by organization.name)
      from public.organization_memberships membership
      join public.organizations organization on organization.id = membership.organization_id
      where membership.user_id = profile.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'team_id', membership.team_id,
        'team_name', team.name,
        'role_id', membership.role_id,
        'status', membership.status
      ) order by team.name)
      from public.team_memberships membership
      join public.teams team on team.id = membership.team_id
      where membership.user_id = profile.id
    ), '[]'::jsonb),
    (
      select count(*)
      from public.workspace_invites invite
      where invite.email_normalized in (
        select lower(trim(user_record.email))
        from auth.users user_record
        where user_record.id = profile.id
      )
        and invite.status = 'pending'
        and (invite.expires_at is null or invite.expires_at > now())
    )
  from public.profiles profile
  where (select auth.uid()) is not null
    and public.is_platform_admin()
  order by profile.display_name, profile.id;
$$;

create or replace function public.admin_get_user(target_user_id uuid)
returns table (
  id uuid,
  display_name text,
  platform_roles text[],
  organization_memberships jsonb,
  team_memberships jsonb,
  pending_invitations bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.admin_list_users()
  where id = target_user_id;
$$;

create or replace function public.admin_list_memberships(target_team_id uuid)
returns table (
  user_id uuid,
  display_name text,
  role_id text,
  role_label text,
  status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    membership.user_id,
    profile.display_name,
    membership.role_id,
    role.label,
    membership.status,
    membership.created_at
  from public.team_memberships membership
  join public.profiles profile on profile.id = membership.user_id
  join public.roles role on role.id = membership.role_id
  where membership.team_id = target_team_id
    and (select auth.uid()) is not null
    and public.is_platform_admin()
  order by membership.created_at;
$$;

create or replace function public.admin_list_invitations(target_team_id uuid default null)
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  email text,
  display_name text,
  role_id text,
  status text,
  invited_by uuid,
  expires_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    invite.id,
    invite.team_id,
    coalesce(team.name, organization.name),
    invite.email_normalized,
    invite.display_name,
    coalesce(invite.role_id, invite.organization_role_id),
    case
      when invite.status = 'pending'
       and invite.expires_at is not null
       and invite.expires_at <= now() then 'expired'
      else invite.status
    end,
    invite.invited_by,
    invite.expires_at,
    invite.created_at
  from public.workspace_invites invite
  join public.organizations organization on organization.id = invite.organization_id
  left join public.teams team on team.id = invite.team_id
  where (target_team_id is null or invite.team_id = target_team_id)
    and (select auth.uid()) is not null
    and public.is_platform_admin()
  order by invite.created_at desc;
$$;

create or replace function public.admin_revoke_invitation(target_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  invite public.workspace_invites%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform Admin access is required.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invitation_id
  for update;

  if not found or invite.status <> 'pending' then
    raise exception 'Only pending invitations can be revoked.';
  end if;

  update public.workspace_invites
  set status = 'revoked',
      updated_at = now()
  where id = invite.id
    and status = 'pending';

  if not found then
    raise exception 'The invitation changed concurrently.';
  end if;

  return jsonb_build_object('id', invite.id, 'status', 'revoked');
end;
$$;

create or replace function public.admin_set_beta_status(
  target_kind text,
  target_id uuid,
  new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  normalized_status text := lower(trim(coalesce(new_status, '')));
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform Admin access is required.';
  end if;

  if target_id is null or normalized_status not in ('none', 'beta_team', 'early_adopter') then
    raise exception 'A valid target and beta status are required.';
  end if;

  if target_kind = 'organization' then
    update public.organizations
    set beta_status = normalized_status,
        updated_at = now()
    where id = target_id;

    if not found then
      raise exception 'Organization not found.';
    end if;
  elsif target_kind = 'team' then
    update public.teams
    set beta_status = normalized_status
    where id = target_id;

    if not found then
      raise exception 'Team not found.';
    end if;
  else
    raise exception 'Unsupported beta target.';
  end if;

  return jsonb_build_object(
    'kind', target_kind,
    'id', target_id,
    'beta_status', normalized_status
  );
end;
$$;

revoke all on function public.is_platform_founder() from public, anon;
revoke all on function public.admin_list_organizations() from public, anon;
revoke all on function public.admin_get_organization(uuid) from public, anon;
revoke all on function public.admin_list_teams(uuid) from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_get_user(uuid) from public, anon;
revoke all on function public.admin_list_memberships(uuid) from public, anon;
revoke all on function public.admin_list_invitations(uuid) from public, anon;
revoke all on function public.admin_revoke_invitation(uuid) from public, anon;
revoke all on function public.admin_set_beta_status(text, uuid, text) from public, anon;

grant execute on function public.admin_list_organizations() to authenticated;
grant execute on function public.is_platform_founder() to authenticated;
grant execute on function public.admin_get_organization(uuid) to authenticated;
grant execute on function public.admin_list_teams(uuid) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_get_user(uuid) to authenticated;
grant execute on function public.admin_list_memberships(uuid) to authenticated;
grant execute on function public.admin_list_invitations(uuid) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_set_beta_status(text, uuid, text) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.platform_admins', 'insert, update, delete') then
    raise exception 'Platform admin grants must remain controlled outside browser roles.';
  end if;

  if has_table_privilege('authenticated', 'public.workspace_invites', 'select') then
    raise exception 'Direct workspace invite reads must remain unavailable to browser roles.';
  end if;

  if has_function_privilege('anon', 'public.is_platform_founder()', 'execute')
     or has_function_privilege('anon', 'public.admin_list_organizations()', 'execute')
     or has_function_privilege('anon', 'public.admin_get_organization(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_list_teams(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_list_users()', 'execute')
     or has_function_privilege('anon', 'public.admin_get_user(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_list_memberships(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_list_invitations(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_revoke_invitation(uuid)', 'execute')
     or has_function_privilege('anon', 'public.admin_set_beta_status(text,uuid,text)', 'execute') then
    raise exception 'Anonymous execution remains granted to an admin reconciliation RPC.';
  end if;
end;
$$;
