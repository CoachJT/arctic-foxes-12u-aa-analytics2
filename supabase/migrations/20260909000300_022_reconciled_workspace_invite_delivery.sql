-- Forward-only staff invite delivery bridge after production ledger 019.
-- workspace_invites remains authoritative and unreadable to browser roles.
-- These RPCs extend migration 018's database-backed claim/record/rotation
-- protections to team-owner staff invitations.

create or replace function public.list_workspace_invites(target_team_id uuid)
returns table (
  invite_id uuid,
  email text,
  display_name text,
  role_id text,
  status text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if target_team_id is null
     or not (
       public.is_platform_admin()
       or public.has_team_capability(target_team_id, 'admin.users')
     ) then
    raise exception 'Workspace invitation access is required.';
  end if;

  return query
  select
    invite.id,
    invite.email_normalized,
    invite.display_name,
    invite.role_id,
    case
      when invite.status = 'pending'
       and invite.expires_at is not null
       and invite.expires_at <= now() then 'expired'
      else invite.status
    end,
    invite.created_at,
    invite.expires_at
  from public.workspace_invites invite
  where invite.team_id = target_team_id
  order by invite.created_at desc;
end;
$$;

create or replace function public.claim_workspace_invite_delivery(
  target_invite_id uuid,
  allow_resend boolean default false
)
returns table (
  claimed boolean,
  reason text,
  invite_status text,
  delivery_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.workspace_invites%rowtype;
  current_state text;
  last_attempt_at timestamptz;
  last_sent_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invite_id
  for update;

  if not found or invite.team_id is null then
    raise exception 'The workspace invitation could not be found.';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_team_capability(invite.team_id, 'admin.users')
  ) then
    raise exception 'Workspace invitation access is required.';
  end if;

  if invite.status <> 'pending' then
    return query select false, 'invite_not_pending', invite.status, invite.metadata->>'delivery_state';
    return;
  end if;

  if invite.expires_at is not null
     and invite.expires_at <= now()
     and not allow_resend then
    return query select false, 'invite_expired', invite.status, invite.metadata->>'delivery_state';
    return;
  end if;

  current_state := coalesce(invite.metadata->>'delivery_state', 'pending_controlled_delivery');
  last_attempt_at := nullif(invite.metadata->>'email_attempted_at', '')::timestamptz;
  last_sent_at := nullif(invite.metadata->>'email_sent_at', '')::timestamptz;

  if current_state = 'email_sending'
     and last_attempt_at is not null
     and last_attempt_at > now() - interval '2 minutes' then
    return query select false, 'delivery_in_progress', invite.status, current_state;
    return;
  end if;

  if current_state = 'email_sent' then
    if not allow_resend then
      return query select false, 'already_sent', invite.status, current_state;
      return;
    end if;

    if last_sent_at is not null and last_sent_at > now() - interval '60 seconds' then
      return query select false, 'resend_cooldown', invite.status, current_state;
      return;
    end if;
  end if;

  update public.workspace_invites
  set metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'delivery_state', 'email_sending',
          'email_attempted_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
        ),
      updated_at = now()
  where id = invite.id
    and status = 'pending';

  if not found then
    return query select false, 'invite_changed', invite.status, current_state;
    return;
  end if;

  return query select true, 'claimed', invite.status, 'email_sending'::text;
end;
$$;

create or replace function public.record_workspace_invite_delivery(
  target_invite_id uuid,
  target_delivered boolean,
  target_failure_reason text default null
)
returns table (
  invite_status text,
  delivery_state text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.workspace_invites%rowtype;
  next_state text;
  sanitized_reason text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invite_id
  for update;

  if not found or invite.team_id is null then
    raise exception 'The workspace invitation could not be found.';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_team_capability(invite.team_id, 'admin.users')
  ) then
    raise exception 'Workspace invitation access is required.';
  end if;

  if invite.metadata->>'delivery_state' <> 'email_sending' then
    raise exception 'The workspace invitation delivery was not claimed.';
  end if;

  next_state := case when target_delivered then 'email_sent' else 'pending_controlled_delivery' end;
  sanitized_reason := nullif(
    left(regexp_replace(coalesce(target_failure_reason, ''), '[A-Za-z0-9_\-]{24,}', '[redacted]', 'g'), 240),
    ''
  );

  update public.workspace_invites
  set metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('delivery_state', next_state)
        || case
             when target_delivered then jsonb_build_object(
               'email_sent_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'email_failure_reason', null
             )
             else jsonb_build_object('email_failure_reason', sanitized_reason)
           end,
      updated_at = now()
  where id = invite.id
    and status = 'pending';

  if not found then
    raise exception 'The workspace invitation changed concurrently.';
  end if;

  return query select invite.status, next_state;
end;
$$;

create or replace function public.rotate_workspace_invite_delivery_token(
  target_invite_id uuid,
  target_token_hash text
)
returns table (
  invite_id uuid,
  invite_status text,
  invite_expires_at timestamptz,
  invite_email text,
  invite_display_name text,
  invite_role_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.workspace_invites%rowtype;
  refreshed_expires_at timestamptz := now() + interval '72 hours';
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required.';
  end if;

  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid token hash is required.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invite_id
  for update;

  if not found or invite.team_id is null or invite.status <> 'pending' then
    raise exception 'Only a pending team invitation can be reissued.';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_team_capability(invite.team_id, 'admin.users')
  ) then
    raise exception 'Workspace invitation access is required.';
  end if;

  if invite.metadata->>'delivery_state' <> 'email_sending' then
    raise exception 'Claim invitation delivery before rotating its token.';
  end if;

  if exists (
    select 1
    from public.workspace_invites candidate
    where candidate.token_hash = target_token_hash
      and candidate.id <> invite.id
  ) then
    raise exception 'The invite token hash already exists.';
  end if;

  update public.workspace_invites
  set token_hash = target_token_hash,
      expires_at = refreshed_expires_at,
      updated_at = now()
  where id = invite.id
    and status = 'pending';

  if not found then
    raise exception 'The workspace invitation changed concurrently.';
  end if;

  return query
  select
    invite.id,
    invite.status,
    refreshed_expires_at,
    invite.email_normalized,
    invite.display_name,
    invite.role_id;
end;
$$;

revoke all on function public.list_workspace_invites(uuid) from public, anon;
revoke all on function public.claim_workspace_invite_delivery(uuid, boolean) from public, anon;
revoke all on function public.record_workspace_invite_delivery(uuid, boolean, text) from public, anon;
revoke all on function public.rotate_workspace_invite_delivery_token(uuid, text) from public, anon;

grant execute on function public.list_workspace_invites(uuid) to authenticated;
grant execute on function public.claim_workspace_invite_delivery(uuid, boolean) to authenticated;
grant execute on function public.record_workspace_invite_delivery(uuid, boolean, text) to authenticated;
grant execute on function public.rotate_workspace_invite_delivery_token(uuid, text) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.workspace_invites', 'select') then
    raise exception 'Direct workspace invite reads must remain unavailable to browser roles.';
  end if;

  if has_function_privilege('anon', 'public.list_workspace_invites(uuid)', 'execute')
     or has_function_privilege('anon', 'public.claim_workspace_invite_delivery(uuid,boolean)', 'execute')
     or has_function_privilege('anon', 'public.record_workspace_invite_delivery(uuid,boolean,text)', 'execute')
     or has_function_privilege('anon', 'public.rotate_workspace_invite_delivery_token(uuid,text)', 'execute') then
    raise exception 'Anonymous execution remains granted to an invite delivery RPC.';
  end if;
end;
$$;
