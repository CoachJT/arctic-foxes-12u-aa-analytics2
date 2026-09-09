-- Platform Admin Dashboard data model for PuckNexus 2.0 Stage 4.
-- Additive only: no destructive changes, no hardcoded user identities.
-- Provides (1) beta/early-adopter state, (2) a first-class invitation lifecycle,
-- and (3) platform-admin-only security-definer read RPCs for dashboard data
-- that RLS correctly keeps invisible to ordinary members (e.g. users without
-- any memberships, cross-team user inventories).

-- 1. Beta / early-adopter state on organizations and teams.
alter table public.organizations
  add column if not exists beta_status text not null default 'none'
    check (beta_status in ('none', 'beta_team', 'early_adopter'));

alter table public.teams
  add column if not exists beta_status text not null default 'none'
    check (beta_status in ('none', 'beta_team', 'early_adopter'));

-- 2. Invitation lifecycle. team_memberships.status already tracks
-- invited/accepted (active)/suspended; this table adds the operational record
-- (email, token, expiry, revocation) the Admin Dashboard manages.
create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  display_name text not null default '',
  role_id text not null references public.roles(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index team_invitations_team_status_idx on public.team_invitations(team_id, status);
create index team_invitations_email_idx on public.team_invitations(lower(email));

alter table public.team_invitations enable row level security;

create policy team_invitations_select_for_owners_or_platform_admins
on public.team_invitations for select
to authenticated
using (public.is_team_owner(team_id) or public.is_platform_admin());

create policy team_invitations_insert_for_owners_or_platform_admins
on public.team_invitations for insert
to authenticated
with check (public.is_team_owner(team_id) or public.is_platform_admin());

create policy team_invitations_update_for_owners_or_platform_admins
on public.team_invitations for update
to authenticated
using (public.is_team_owner(team_id) or public.is_platform_admin())
with check (public.is_team_owner(team_id) or public.is_platform_admin());

create policy team_invitations_delete_for_platform_admins
on public.team_invitations for delete
to authenticated
using (public.is_platform_admin());

revoke all on public.team_invitations from anon;
grant select, insert, update, delete on public.team_invitations to authenticated;
grant select, insert, update, delete on public.team_invitations to service_role;

-- 3. Platform-admin read RPCs. Each guards with is_platform_admin() and returns
-- only operational fields: no secrets, tokens, password data, or auth internals.
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
  select o.id, o.name, o.slug, o.status, o.beta_status, o.created_at,
         (select count(*) from public.teams t where t.organization_id = o.id),
         (select count(*) from public.organization_memberships om where om.organization_id = o.id)
  from public.organizations o
  where public.is_platform_admin()
  order by o.created_at desc;
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
  select o.id, o.name, o.slug, o.status, o.beta_status, o.created_at
  from public.organizations o
  where o.id = target_organization_id
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
  select t.id, t.name, t.slug, t.organization_id, o.name as organization_name,
         t.default_season_id, s.season_key as default_season_key,
         t.beta_status, t.created_at,
         (select count(*) from public.team_memberships tm where tm.team_id = t.id),
         (select count(*) from public.team_memberships tm where tm.team_id = t.id and tm.status = 'invited')
  from public.teams t
  left join public.organizations o on o.id = t.organization_id
  left join public.seasons s on s.id = t.default_season_id
  where public.is_platform_admin()
    and (target_organization_id is null or t.organization_id = target_organization_id)
  order by t.created_at desc;
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
  select p.id, p.display_name,
         coalesce((select array_agg(pr.role) from public.platform_roles pr
                   where pr.user_id = p.id and pr.status = 'active'), '{}'::text[]),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'organization_id', om.organization_id,
                     'organization_name', o.name,
                     'role', om.role,
                     'status', om.status))
                   from public.organization_memberships om
                   join public.organizations o on o.id = om.organization_id
                   where om.user_id = p.id), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'team_id', tm.team_id,
                     'team_name', t.name,
                     'role_id', tm.role_id,
                     'status', tm.status))
                   from public.team_memberships tm
                   join public.teams t on t.id = tm.team_id
                   where tm.user_id = p.id), '[]'::jsonb),
         (select count(*) from public.team_memberships tm
          where tm.user_id = p.id and tm.status = 'invited')
  from public.profiles p
  where public.is_platform_admin()
  order by p.created_at desc;
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
  select u.id, u.display_name, u.platform_roles, u.organization_memberships,
         u.team_memberships, u.pending_invitations
  from public.admin_list_users() u
  where u.id = target_user_id;
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
  select tm.user_id, p.display_name, tm.role_id, r.label as role_label, tm.status, tm.created_at
  from public.team_memberships tm
  join public.profiles p on p.id = tm.user_id
  join public.roles r on r.id = tm.role_id
  where tm.team_id = target_team_id
    and public.is_platform_admin()
  order by tm.created_at asc;
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
  select i.id, i.team_id, t.name as team_name, i.email, i.display_name, i.role_id,
         case
           when i.status = 'pending' and i.expires_at < now() then 'expired'
           else i.status
         end as status,
         i.invited_by, i.expires_at, i.created_at
  from public.team_invitations i
  join public.teams t on t.id = i.team_id
  where public.is_platform_admin()
    and (target_team_id is null or i.team_id = target_team_id)
  order by i.created_at desc;
$$;

-- 4. Privileged writes. Every mutation re-validates the actor server-side and
-- fails closed. No founder management is exposed here by design.

create or replace function public.admin_resend_invitation(target_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.team_invitations;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin access is required.';
  end if;
  select * into invitation
  from public.team_invitations
  where id = target_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if invitation.status <> 'pending' then
    raise exception 'Only pending invitations can be resent.';
  end if;
  update public.team_invitations
  set expires_at = now() + interval '14 days',
      updated_at = now()
  where id = invitation.id;
  return jsonb_build_object(
    'id', invitation.id,
    'email', invitation.email,
    'status', 'pending',
    'expires_at', now() + interval '14 days'
  );
end;
$$;

create or replace function public.admin_revoke_invitation(target_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.team_invitations;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin access is required.';
  end if;
  select * into invitation
  from public.team_invitations
  where id = target_invitation_id
  for update;
  if not found then
    raise exception 'Invitation not found.';
  end if;
  if invitation.status in ('accepted', 'revoked') then
    raise exception 'Only pending or expired invitations can be revoked.';
  end if;
  update public.team_invitations
  set status = 'revoked',
      updated_at = now()
  where id = invitation.id;
  return jsonb_build_object('id', invitation.id, 'status', 'revoked');
end;
$$;

create or replace function public.admin_set_beta_status(target_kind text, target_id uuid, new_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform Admin access is required.';
  end if;
  if new_status not in ('none', 'beta_team', 'early_adopter') then
    raise exception 'Unsupported beta status.';
  end if;
  if target_kind = 'organization' then
    update public.organizations
    set beta_status = new_status, updated_at = now()
    where id = target_id;
    if not found then
      raise exception 'Organization not found.';
    end if;
    return jsonb_build_object('kind', 'organization', 'id', target_id, 'beta_status', new_status);
  elsif target_kind = 'team' then
    update public.teams
    set beta_status = new_status
    where id = target_id;
    if not found then
      raise exception 'Team not found.';
    end if;
    return jsonb_build_object('kind', 'team', 'id', target_id, 'beta_status', new_status);
  end if;
  raise exception 'Unsupported beta target.';
end;
$$;

revoke all on function public.admin_list_organizations() from public;
revoke all on function public.admin_get_organization(uuid) from public;
revoke all on function public.admin_list_teams(uuid) from public;
revoke all on function public.admin_list_users() from public;
revoke all on function public.admin_get_user(uuid) from public;
revoke all on function public.admin_list_memberships(uuid) from public;
revoke all on function public.admin_list_invitations(uuid) from public;
revoke all on function public.admin_resend_invitation(uuid) from public;
revoke all on function public.admin_revoke_invitation(uuid) from public;
revoke all on function public.admin_set_beta_status(text, uuid, text) from public;

grant execute on function public.admin_list_organizations() to authenticated;
grant execute on function public.admin_get_organization(uuid) to authenticated;
grant execute on function public.admin_list_teams(uuid) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_get_user(uuid) to authenticated;
grant execute on function public.admin_list_memberships(uuid) to authenticated;
grant execute on function public.admin_list_invitations(uuid) to authenticated;
grant execute on function public.admin_resend_invitation(uuid) to authenticated;
grant execute on function public.admin_revoke_invitation(uuid) to authenticated;
grant execute on function public.admin_set_beta_status(text, uuid, text) to authenticated;
