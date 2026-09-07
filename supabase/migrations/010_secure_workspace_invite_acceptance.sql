-- PuckNexus 2.0 Stage D secure workspace invite creation and acceptance.
-- Additive only: no existing users, memberships, teams, seasons, or roles are
-- rewritten. Invite-table access is narrowed so token hashes are never read
-- directly by browser clients.

alter table public.workspace_invites
  add column email_normalized text,
  add column display_name text,
  add column organization_role_id text;

alter table public.workspace_invites
  alter column role_id drop not null,
  alter column email_normalized set not null,
  alter column display_name set not null;

alter table public.workspace_invites
  add constraint workspace_invites_email_normalized_ck
    check (email_normalized = lower(trim(email_normalized))),
  add constraint workspace_invites_display_name_ck
    check (length(trim(display_name)) > 0),
  add constraint workspace_invites_token_hash_sha256_ck
    check (token_hash ~ '^[0-9a-f]{64}$'),
  add constraint workspace_invites_organization_role_ck
    check (
      organization_role_id is null
      or organization_role_id in ('org_owner', 'org_admin', 'org_member')
    ),
  add constraint workspace_invites_target_role_ck
    check (
      (
        team_id is not null
        and role_id is not null
        and organization_role_id is null
      )
      or (
        team_id is null
        and role_id is null
        and organization_role_id is not null
      )
    );

create index workspace_invites_email_status_idx
  on public.workspace_invites(email_normalized, status);

-- Browser clients must use the narrowly scoped RPCs below. In particular,
-- authenticated clients must not select token_hash or recipient email fields.
revoke all on public.workspace_invites from public, anon, authenticated;

create or replace function public.create_workspace_invite(
  target_organization_id uuid,
  target_team_id uuid,
  target_season_id uuid,
  target_email_normalized text,
  target_display_name text,
  target_role_id text,
  target_organization_role_id text,
  target_plan_id text,
  target_token_hash text,
  target_expires_at timestamptz,
  replace_invite_id uuid default null
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
  normalized_email text := lower(trim(target_email_normalized));
  existing_invite public.workspace_invites%rowtype;
  target_team_organization_id uuid;
  target_season_team_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if target_organization_id is null
     or target_email_normalized is null
     or normalized_email = ''
     or normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A valid organization and invite email are required.';
  end if;

  if target_display_name is null
     or length(trim(target_display_name)) = 0
     or length(trim(target_display_name)) > 120 then
    raise exception 'A valid display name is required.';
  end if;

  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid token hash is required.';
  end if;

  if target_plan_id is null
     or not exists (
       select 1
       from public.plan_catalog plan
       where plan.plan_id = target_plan_id
         and plan.status = 'active'
     ) then
    raise exception 'The requested plan is not active.';
  end if;

  if target_expires_at is not null and target_expires_at <= now() then
    raise exception 'Invite expiry must be in the future.';
  end if;

  if not exists (
    select 1
    from public.organizations organization
    where organization.id = target_organization_id
      and organization.status = 'active'
  ) then
    raise exception 'The target organization is not active.';
  end if;

  if target_team_id is not null then
    select team.organization_id
    into target_team_organization_id
    from public.teams team
    where team.id = target_team_id;

    if target_team_organization_id is distinct from target_organization_id then
      raise exception 'Invite team must belong to the target organization.';
    end if;

    if target_season_id is not null then
      select season.team_id
      into target_season_team_id
      from public.seasons season
      where season.id = target_season_id;

      if target_season_team_id is distinct from target_team_id then
        raise exception 'Invite season must belong to the target team.';
      end if;
    end if;

    if target_role_id is null
       or target_organization_role_id is not null
       or not exists (
         select 1
         from public.roles role
         where role.id = target_role_id
       ) then
      raise exception 'A valid team role is required.';
    end if;

    if not public.has_team_capability(target_team_id, 'admin.users') then
      raise exception 'Team invite permission is required.';
    end if;

    if target_role_id = 'owner'
       and not public.is_team_owner(target_team_id) then
      raise exception 'Only a team owner can assign the owner role.';
    end if;
  else
    if target_season_id is not null
       or target_role_id is not null
       or target_organization_role_id <> 'org_member' then
      raise exception 'Organization invites must target org_member without a team.';
    end if;

    if not (
      public.has_org_role(target_organization_id, 'org_owner')
      or public.has_org_role(target_organization_id, 'org_admin')
    ) then
      raise exception 'Organization invite permission is required.';
    end if;
  end if;

  if replace_invite_id is not null then
    select *
    into existing_invite
    from public.workspace_invites invite
    where invite.id = replace_invite_id
    for update;

    if not found or existing_invite.status <> 'pending' then
      raise exception 'Only a pending invite can be reissued.';
    end if;

    if existing_invite.team_id is not null then
      if not public.has_team_capability(existing_invite.team_id, 'admin.users') then
        raise exception 'Invite reissue permission is required.';
      end if;
    elsif not (
      public.has_org_role(existing_invite.organization_id, 'org_owner')
      or public.has_org_role(existing_invite.organization_id, 'org_admin')
    ) then
      raise exception 'Invite reissue permission is required.';
    end if;

    update public.workspace_invites
    set status = 'revoked',
        updated_at = now()
    where id = replace_invite_id;
  end if;

  if exists (
    select 1
    from public.workspace_invites invite
    where invite.token_hash = target_token_hash
  ) then
    raise exception 'The invite token hash already exists.';
  end if;

  return query
  insert into public.workspace_invites (
    organization_id,
    team_id,
    season_id,
    role_id,
    organization_role_id,
    plan_id,
    token_hash,
    email_normalized,
    display_name,
    invited_by,
    status,
    expires_at
  )
  values (
    target_organization_id,
    target_team_id,
    target_season_id,
    target_role_id,
    target_organization_role_id,
    target_plan_id,
    target_token_hash,
    normalized_email,
    trim(target_display_name),
    caller_id,
    'pending',
    target_expires_at
  )
  returning id, status, expires_at;
end;
$$;

create or replace function public.accept_workspace_invite(
  target_token_hash text
)
returns table (
  invite_id uuid,
  organization_id uuid,
  team_id uuid,
  season_id uuid,
  role_id text,
  organization_role_id text,
  plan_id text,
  membership_status text,
  accepted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_email text;
  caller_email_confirmed_at timestamptz;
  invite public.workspace_invites%rowtype;
  existing_org_membership public.organization_memberships%rowtype;
  existing_team_membership public.team_memberships%rowtype;
  existing_team_entitlement public.team_membership_entitlements%rowtype;
  existing_org_entitlement public.organization_entitlements%rowtype;
  accepted_timestamp timestamptz := now();
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The invite token is invalid.';
  end if;

  select user_record.email, user_record.email_confirmed_at
  into caller_email, caller_email_confirmed_at
  from auth.users user_record
  where user_record.id = caller_id;

  if caller_email is null or caller_email_confirmed_at is null then
    raise exception 'A verified authenticated email is required.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.token_hash = target_token_hash
  for update;

  if not found
     or invite.status <> 'pending'
     or (invite.expires_at is not null and invite.expires_at <= now()) then
    raise exception 'The invite is invalid, expired, revoked, or already accepted.';
  end if;

  if lower(trim(caller_email)) <> invite.email_normalized then
    raise exception 'The authenticated email does not match the invite.';
  end if;

  if not exists (
    select 1
    from public.organizations organization
    where organization.id = invite.organization_id
      and organization.status = 'active'
  ) then
    raise exception 'The invited organization is no longer active.';
  end if;

  if invite.team_id is not null then
    if not exists (
      select 1
      from public.teams team
      where team.id = invite.team_id
        and team.organization_id = invite.organization_id
    ) then
      raise exception 'The invited team no longer belongs to the organization.';
    end if;

    if invite.season_id is not null
       and not exists (
         select 1
         from public.seasons season
         where season.id = invite.season_id
           and season.team_id = invite.team_id
       ) then
      raise exception 'The invited season no longer belongs to the team.';
    end if;

    if invite.role_id is null
       or not exists (
         select 1
         from public.roles role
         where role.id = invite.role_id
       ) then
      raise exception 'The invited team role is no longer valid.';
    end if;
  elsif invite.organization_role_id is null
     or invite.organization_role_id <> 'org_member' then
    raise exception 'The invited organization role is no longer valid.';
  end if;

  insert into public.profiles (id, display_name)
  values (caller_id, invite.display_name)
  on conflict (id) do nothing;

  select *
  into existing_org_membership
  from public.organization_memberships membership
  where membership.organization_id = invite.organization_id
    and membership.user_id = caller_id
  for update;

  if not found then
    insert into public.organization_memberships (
      organization_id,
      user_id,
      role_id,
      status
    )
    values (
      invite.organization_id,
      caller_id,
      coalesce(invite.organization_role_id, 'org_member'),
      'active'
    );
  elsif existing_org_membership.status = 'suspended' then
    raise exception 'The existing organization membership is suspended.';
  elsif existing_org_membership.status = 'invited' then
    update public.organization_memberships
    set status = 'active',
        updated_at = now()
    where organization_id = invite.organization_id
      and user_id = caller_id;
  end if;

  if invite.team_id is not null then
    select *
    into existing_team_membership
    from public.team_memberships membership
    where membership.team_id = invite.team_id
      and membership.user_id = caller_id
    for update;

    if not found then
      insert into public.team_memberships (
        team_id,
        user_id,
        role_id,
        status,
        invited_by
      )
      values (
        invite.team_id,
        caller_id,
        invite.role_id,
        'active',
        invite.invited_by
      );
    elsif existing_team_membership.status = 'suspended' then
      raise exception 'The existing team membership is suspended.';
    elsif existing_team_membership.role_id <> invite.role_id then
      raise exception 'The existing team role differs from the invite.';
    elsif existing_team_membership.status = 'invited' then
      update public.team_memberships
      set status = 'active',
          updated_at = now()
      where team_id = invite.team_id
        and user_id = caller_id;
    end if;

    select *
    into existing_team_entitlement
    from public.team_membership_entitlements entitlement
    where entitlement.team_id = invite.team_id
      and entitlement.user_id = caller_id
      and entitlement.status = 'active'
      and entitlement.starts_at <= now()
      and (entitlement.ends_at is null or entitlement.ends_at > now())
    order by entitlement.starts_at desc, entitlement.created_at desc
    limit 1
    for update;

    if found and existing_team_entitlement.plan_id <> invite.plan_id then
      raise exception 'An existing active team entitlement differs from the invite.';
    elsif not found then
      insert into public.team_membership_entitlements (
        team_id,
        user_id,
        plan_id,
        status,
        metadata
      )
      values (
        invite.team_id,
        caller_id,
        invite.plan_id,
        'active',
        jsonb_build_object('source', 'workspace_invite', 'invite_id', invite.id)
      );
    end if;
  else
    select *
    into existing_org_entitlement
    from public.organization_entitlements entitlement
    where entitlement.organization_id = invite.organization_id
      and entitlement.status = 'active'
      and entitlement.starts_at <= now()
      and (entitlement.ends_at is null or entitlement.ends_at > now())
    order by entitlement.starts_at desc, entitlement.created_at desc
    limit 1
    for update;

    if found and existing_org_entitlement.plan_id <> invite.plan_id then
      raise exception 'An existing active organization entitlement differs from the invite.';
    elsif not found then
      insert into public.organization_entitlements (
        organization_id,
        plan_id,
        status,
        metadata
      )
      values (
        invite.organization_id,
        invite.plan_id,
        'active',
        jsonb_build_object('source', 'workspace_invite', 'invite_id', invite.id)
      );
    end if;
  end if;

  update public.workspace_invites
  set status = 'accepted',
      accepted_by = caller_id,
      accepted_at = accepted_timestamp,
      updated_at = accepted_timestamp
  where id = invite.id
    and status = 'pending';

  if not found then
    raise exception 'The invite was accepted concurrently and cannot be replayed.';
  end if;

  return query
  select
    invite.id,
    invite.organization_id,
    invite.team_id,
    invite.season_id,
    invite.role_id,
    invite.organization_role_id,
    invite.plan_id,
    'active'::text,
    accepted_timestamp;
end;
$$;

create or replace function public.revoke_workspace_invite(
  target_invite_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.workspace_invites%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invite_id
  for update;

  if not found or invite.status <> 'pending' then
    raise exception 'Only a pending invite can be revoked.';
  end if;

  if invite.team_id is not null then
    if not public.has_team_capability(invite.team_id, 'admin.users') then
      raise exception 'Invite revoke permission is required.';
    end if;
  elsif not (
    public.has_org_role(invite.organization_id, 'org_owner')
    or public.has_org_role(invite.organization_id, 'org_admin')
  ) then
    raise exception 'Invite revoke permission is required.';
  end if;

  update public.workspace_invites
  set status = 'revoked',
      updated_at = now()
  where id = invite.id
    and status = 'pending';

  return found;
end;
$$;

revoke all on function public.create_workspace_invite(
  uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid
) from public, anon;
revoke all on function public.accept_workspace_invite(text) from public, anon;
revoke all on function public.revoke_workspace_invite(uuid) from public, anon;

grant execute on function public.create_workspace_invite(
  uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid
) to authenticated;
grant execute on function public.accept_workspace_invite(text) to authenticated;
grant execute on function public.revoke_workspace_invite(uuid) to authenticated;

-- Stage D runtime assertions preserve the Stage 1A/Stage B security boundary.
do $$
begin
  if has_table_privilege('authenticated', 'public.workspace_invites', 'select')
     or has_table_privilege('anon', 'public.workspace_invites', 'select') then
    raise exception 'Direct workspace invite table reads remain exposed.';
  end if;

  if has_function_privilege(
    'anon',
    'public.create_workspace_invite(uuid,uuid,uuid,text,text,text,text,text,text,timestamptz,uuid)',
    'execute'
  )
  or has_function_privilege(
    'anon',
    'public.accept_workspace_invite(text)',
    'execute'
  )
  or has_function_privilege(
    'anon',
    'public.revoke_workspace_invite(uuid)',
    'execute'
  ) then
    raise exception 'Anonymous invite RPC execution remains granted.';
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
    raise exception 'Final-owner trigger execution was broadened.';
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
