-- Platform identity and role separation for PuckNexus 2.0 Stage 2.
-- Platform privileges (founder, platform_admin) are global and stored separately
-- from organization and team roles. Team or organization membership never grants
-- platform access, and platform roles never require a team membership.
-- This migration is additive: it creates no users and no production identities.

-- 1. Platform roles: global privileges, independent of teams and organizations.
create table public.platform_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('founder', 'platform_admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index platform_roles_user_idx on public.platform_roles(user_id);

-- 2. Platform authorization helpers (security definer, mirroring the 001 pattern).
create or replace function public.has_platform_role(requested_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_roles platform_role
    where platform_role.user_id = (select auth.uid())
      and platform_role.role = requested_role
      and platform_role.status = 'active'
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_roles platform_role
    where platform_role.user_id = (select auth.uid())
      and platform_role.role in ('founder', 'platform_admin')
      and platform_role.status = 'active'
  );
$$;

create or replace function public.is_platform_founder()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_platform_role('founder');
$$;

-- 3. Organization authorization helpers. Organization roles stay org-scoped.
create or replace function public.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
  );
$$;

create or replace function public.has_org_role(target_organization_id uuid, requested_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and membership.role = any (requested_roles)
  );
$$;

create or replace function public.is_org_owner(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_org_role(target_organization_id, array['owner']::text[]);
$$;

-- 4. Row level security for platform roles.
-- Users may read their own platform roles. Only active platform admins manage
-- platform roles, and only founders can grant, modify, or remove founder.
alter table public.platform_roles enable row level security;

create policy platform_roles_select_self_or_admin
on public.platform_roles for select
to authenticated
using (user_id = (select auth.uid()) or public.is_platform_admin());

create policy platform_roles_insert_for_platform_admins
on public.platform_roles for insert
to authenticated
with check (
  public.is_platform_admin()
  and (role = 'platform_admin' or public.is_platform_founder())
);

create policy platform_roles_update_for_platform_admins
on public.platform_roles for update
to authenticated
using (public.is_platform_admin())
with check (
  public.is_platform_admin()
  and (role = 'platform_admin' or public.is_platform_founder())
);

create policy platform_roles_delete_for_platform_admins
on public.platform_roles for delete
to authenticated
using (
  public.is_platform_admin()
  and (role = 'platform_admin' or public.is_platform_founder())
);

-- 5. Row level security for the Stage 1 multi-team foundation tables.
-- Team members keep team-scoped access; organization owners manage their own
-- organization; platform admins receive the read/manage access the future
-- Platform Admin Dashboard requires. None of these policies depend on the
-- caller holding any team membership.
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.seasons enable row level security;
alter table public.team_branding enable row level security;

create policy organizations_select_for_members_or_platform_admins
on public.organizations for select
to authenticated
using (public.is_org_member(id) or public.is_platform_admin());

create policy organizations_insert_for_platform_admins
on public.organizations for insert
to authenticated
with check (public.is_platform_admin());

create policy organizations_update_for_org_owners_or_platform_admins
on public.organizations for update
to authenticated
using (public.is_org_owner(id) or public.is_platform_admin())
with check (public.is_org_owner(id) or public.is_platform_admin());

create policy organizations_delete_for_platform_admins
on public.organizations for delete
to authenticated
using (public.is_platform_admin());

create policy organization_memberships_select_for_members_or_platform_admins
on public.organization_memberships for select
to authenticated
using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy organization_memberships_insert_for_org_owners_or_platform_admins
on public.organization_memberships for insert
to authenticated
with check (public.is_org_owner(organization_id) or public.is_platform_admin());

create policy organization_memberships_update_for_org_owners_or_platform_admins
on public.organization_memberships for update
to authenticated
using (public.is_org_owner(organization_id) or public.is_platform_admin())
with check (public.is_org_owner(organization_id) or public.is_platform_admin());

create policy organization_memberships_delete_for_org_owners_platform_admins_or_self
on public.organization_memberships for delete
to authenticated
using (
  public.is_org_owner(organization_id)
  or public.is_platform_admin()
  or user_id = (select auth.uid())
);

create policy seasons_select_for_team_members_or_platform_admins
on public.seasons for select
to authenticated
using (public.is_team_member(team_id) or public.is_platform_admin());

create policy seasons_insert_for_team_owners_or_platform_admins
on public.seasons for insert
to authenticated
with check (public.has_team_capability(team_id, 'admin.permissions') or public.is_platform_admin());

create policy seasons_update_for_team_owners_or_platform_admins
on public.seasons for update
to authenticated
using (public.has_team_capability(team_id, 'admin.permissions') or public.is_platform_admin())
with check (public.has_team_capability(team_id, 'admin.permissions') or public.is_platform_admin());

create policy seasons_delete_for_team_owners_or_platform_admins
on public.seasons for delete
to authenticated
using (public.has_team_capability(team_id, 'seasons.delete') or public.is_platform_admin());

create policy team_branding_select_for_team_members_or_platform_admins
on public.team_branding for select
to authenticated
using (public.is_team_member(team_id) or public.is_platform_admin());

create policy team_branding_insert_for_team_owners_or_platform_admins
on public.team_branding for insert
to authenticated
with check (public.has_team_capability(team_id, 'admin.permissions') or public.is_platform_admin());

create policy team_branding_update_for_team_owners_or_platform_admins
on public.team_branding for update
to authenticated
using (public.has_team_capability(team_id, 'admin.permissions') or public.is_platform_admin())
with check (public.has_team_capability(team_id, 'admin.permissions') or public.is_platform_admin());

create policy team_branding_delete_for_platform_admins
on public.team_branding for delete
to authenticated
using (public.is_platform_admin());

-- Platform admins can inspect teams for support and troubleshooting without
-- holding any team membership.
create policy teams_select_for_platform_admins
on public.teams for select
to authenticated
using (public.is_platform_admin());

-- 6. An organization must retain at least one active owner.
create or replace function public.prevent_final_org_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.organization_id::text, 0));
  if old.role = 'owner'
     and old.status = 'active'
     and (new.role <> 'owner' or new.status <> 'active') then
    if not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = old.organization_id
        and membership.id <> old.id
        and membership.role = 'owner'
        and membership.status = 'active'
    ) then
      raise exception 'An organization must retain at least one active owner.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_final_org_owner_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(old.organization_id::text, 0));
  if old.role = 'owner'
     and old.status = 'active'
     and not exists (
       select 1
       from public.organization_memberships membership
       where membership.organization_id = old.organization_id
         and membership.id <> old.id
         and membership.role = 'owner'
         and membership.status = 'active'
     ) then
    raise exception 'An organization must retain at least one active owner.';
  end if;
  return old;
end;
$$;

create trigger organization_memberships_prevent_final_owner_update
before update of role, status on public.organization_memberships
for each row execute function public.prevent_final_org_owner_loss();

create trigger organization_memberships_prevent_final_owner_delete
before delete on public.organization_memberships
for each row execute function public.prevent_final_org_owner_delete();

-- 7. Grants. RLS governs all authenticated access; anon receives nothing.
revoke all on public.platform_roles, public.organizations,
  public.organization_memberships, public.seasons, public.team_branding
from anon;

grant select, insert, update, delete on public.platform_roles to authenticated;
grant select, insert, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_memberships to authenticated;
grant select, insert, update, delete on public.seasons to authenticated;
grant select, insert, update, delete on public.team_branding to authenticated;

-- The service role provisions platform roles (e.g. the founder account) at
-- deploy time. No user IDs are hardcoded in this migration.
grant select, insert, update, delete on public.platform_roles to service_role;
grant select, insert, update, delete on public.organizations to service_role;
grant select, insert, update, delete on public.organization_memberships to service_role;
grant select, insert, update, delete on public.seasons to service_role;
grant select, insert, update, delete on public.team_branding to service_role;

revoke all on function public.has_platform_role(text) from public;
revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_platform_founder() from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, text[]) from public;
revoke all on function public.is_org_owner(uuid) from public;

grant execute on function public.has_platform_role(text) to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_platform_founder() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.is_org_owner(uuid) to authenticated;
