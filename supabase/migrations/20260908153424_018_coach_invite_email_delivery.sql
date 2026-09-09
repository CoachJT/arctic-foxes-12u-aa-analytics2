-- First-coach invitation email delivery and first-time account claim.
-- Additive only: no existing organizations, teams, seasons, memberships,
-- entitlements, or accepted invitations are rewritten. This migration adds the
-- narrow server-side contracts required to (a) email a pending Beta onboarding
-- invitation exactly once, (b) securely rotate that invitation's token on an
-- explicit resend, and (c) let an invited coach who has never had a PuckNexus
-- account discover the invitation before authenticating.
--
-- Security posture is unchanged: workspace_invites remains unreadable by
-- browser clients, raw tokens are never stored or returned by SQL, and
-- membership creation continues to flow only through accept_workspace_invite.

-- Delivery bookkeeping lives in the existing invite metadata jsonb so no new
-- tenant-scoped table or RLS surface is introduced.

create or replace function public.claim_beta_onboarding_invite_delivery(
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
  caller_id uuid := (select auth.uid());
  invite public.workspace_invites%rowtype;
  current_state text;
  last_attempt_at timestamptz;
  last_sent_at timestamptz;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required to deliver a Beta onboarding invite.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invite_id
  for update;

  if not found
     or invite.metadata->>'source' <> 'beta_onboarding' then
    raise exception 'Only a Beta onboarding invite can be delivered.';
  end if;

  if invite.status <> 'pending' then
    return query select false, 'invite_not_pending', invite.status, invite.metadata->>'delivery_state';
    return;
  end if;

  if invite.expires_at is not null and invite.expires_at <= now() then
    return query select false, 'invite_expired', invite.status, invite.metadata->>'delivery_state';
    return;
  end if;

  current_state := coalesce(invite.metadata->>'delivery_state', 'pending_controlled_delivery');
  last_attempt_at := nullif(invite.metadata->>'email_attempted_at', '')::timestamptz;
  last_sent_at := nullif(invite.metadata->>'email_sent_at', '')::timestamptz;

  -- An in-flight send is only reclaimable once it is demonstrably stale, so an
  -- accidental double submit cannot produce two emails.
  if current_state = 'email_sending'
     and last_attempt_at is not null
     and last_attempt_at > now() - interval '2 minutes' then
    return query select false, 'delivery_in_progress', invite.status, current_state;
    return;
  end if;

  -- Automatic delivery never re-sends. Only an explicit operator resend may,
  -- and only outside a short cooldown that absorbs repeated button presses.
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

create or replace function public.record_beta_onboarding_invite_delivery(
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
  caller_id uuid := (select auth.uid());
  invite public.workspace_invites%rowtype;
  next_state text;
  sanitized_reason text;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  if not public.is_platform_admin() then
    raise exception 'Platform Admin authorization is required to record Beta onboarding delivery.';
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invite_id
  for update;

  if not found
     or invite.metadata->>'source' <> 'beta_onboarding' then
    raise exception 'Only a Beta onboarding invite can be delivered.';
  end if;

  next_state := case when target_delivered then 'email_sent' else 'pending_controlled_delivery' end;

  -- Failure detail is truncated and stripped of anything token-shaped so a
  -- provider error can never persist or leak an acceptance secret.
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
  where id = invite.id;

  return query
  select invite.status, next_state;
end;
$$;

-- In-place token rotation. A resend must never create a second invitation row,
-- so the pending invite keeps its identity, workspace scope, recipient, and
-- role while only its secret and expiry are replaced.
create or replace function public.rotate_beta_onboarding_invite_token(
  target_invite_id uuid,
  target_token_hash text
)
returns table (
  invite_id uuid,
  invite_status text,
  invite_expires_at timestamptz,
  invite_email text,
  invite_display_name text,
  organization_name text,
  team_name text,
  season_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  invite public.workspace_invites%rowtype;
  refreshed_expires_at timestamptz := now() + interval '72 hours';
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
  into invite
  from public.workspace_invites candidate
  where candidate.id = target_invite_id
  for update;

  if not found
     or invite.status <> 'pending'
     or invite.metadata->>'source' <> 'beta_onboarding' then
    raise exception 'Only a pending Beta onboarding invite can be reissued.';
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
    raise exception 'The Beta onboarding invite changed concurrently.';
  end if;

  return query
  select
    invite.id,
    invite.status,
    refreshed_expires_at,
    invite.email_normalized,
    invite.display_name,
    organization.name,
    team.name,
    season.name
  from public.organizations organization
  left join public.teams team on team.id = invite.team_id
  left join public.seasons season on season.id = invite.season_id
  where organization.id = invite.organization_id;
end;
$$;

-- Pre-authentication invite discovery. An invited coach who has never had an
-- account must be able to see what they were invited to before they can hold a
-- session, so this is resolved server-side from the token hash alone and is
-- reachable only through the service role (never anon or authenticated).
create or replace function public.lookup_workspace_invite_by_token(
  target_token_hash text
)
returns table (
  valid boolean,
  reason text,
  invite_email text,
  invite_display_name text,
  organization_name text,
  team_name text,
  account_exists boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  invite public.workspace_invites%rowtype;
  resolved_organization_name text;
  resolved_team_name text;
  resolved_account_exists boolean := false;
begin
  if target_token_hash is null
     or target_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 'invalid', null::text, null::text, null::text, null::text, false;
    return;
  end if;

  select *
  into invite
  from public.workspace_invites candidate
  where candidate.token_hash = target_token_hash;

  if not found then
    return query select false, 'invalid', null::text, null::text, null::text, null::text, false;
    return;
  end if;

  if invite.status = 'accepted' then
    return query select false, 'already_accepted', null::text, null::text, null::text, null::text, false;
    return;
  end if;

  if invite.status <> 'pending' then
    return query select false, 'revoked', null::text, null::text, null::text, null::text, false;
    return;
  end if;

  if invite.expires_at is not null and invite.expires_at <= now() then
    return query select false, 'expired', null::text, null::text, null::text, null::text, false;
    return;
  end if;

  select organization.name
  into resolved_organization_name
  from public.organizations organization
  where organization.id = invite.organization_id
    and organization.status = 'active';

  if resolved_organization_name is null then
    return query select false, 'invalid', null::text, null::text, null::text, null::text, false;
    return;
  end if;

  select team.name
  into resolved_team_name
  from public.teams team
  where team.id = invite.team_id;

  select exists (
    select 1
    from auth.users user_record
    where lower(trim(user_record.email)) = invite.email_normalized
  )
  into resolved_account_exists;

  return query
  select
    true,
    'pending',
    invite.email_normalized,
    invite.display_name,
    resolved_organization_name,
    resolved_team_name,
    resolved_account_exists;
end;
$$;

revoke all on function public.claim_beta_onboarding_invite_delivery(uuid, boolean) from public, anon;
revoke all on function public.record_beta_onboarding_invite_delivery(uuid, boolean, text) from public, anon;
revoke all on function public.rotate_beta_onboarding_invite_token(uuid, text) from public, anon;
revoke all on function public.lookup_workspace_invite_by_token(text) from public, anon, authenticated;

grant execute on function public.claim_beta_onboarding_invite_delivery(uuid, boolean) to authenticated;
grant execute on function public.record_beta_onboarding_invite_delivery(uuid, boolean, text) to authenticated;
grant execute on function public.rotate_beta_onboarding_invite_token(uuid, text) to authenticated;
grant execute on function public.lookup_workspace_invite_by_token(text) to service_role;

-- Runtime assertions preserve the Stage D invite security boundary.
do $$
begin
  if has_table_privilege('authenticated', 'public.workspace_invites', 'select')
     or has_table_privilege('anon', 'public.workspace_invites', 'select') then
    raise exception 'Direct workspace invite table reads remain exposed.';
  end if;

  if has_function_privilege(
       'anon',
       'public.lookup_workspace_invite_by_token(text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.lookup_workspace_invite_by_token(text)',
       'execute'
     ) then
    raise exception 'Pre-authentication invite lookup remains exposed to browser roles.';
  end if;

  if has_function_privilege(
       'anon',
       'public.rotate_beta_onboarding_invite_token(uuid,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.claim_beta_onboarding_invite_delivery(uuid,boolean)',
       'execute'
     ) then
    raise exception 'Anonymous Beta onboarding delivery execution remains granted.';
  end if;
end;
$$;;
