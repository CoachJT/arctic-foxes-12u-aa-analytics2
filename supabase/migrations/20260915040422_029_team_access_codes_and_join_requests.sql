-- PR36 forward-only final contract. No prior PR36 access-code tables exist in production.
create table public.team_access_codes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  code_hash text not null,
  code_digest text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  regenerated_at timestamptz,
  constraint team_access_codes_expiry_check check (expires_at is null or expires_at > created_at)
);
create unique index team_access_codes_one_live_per_team_idx on public.team_access_codes(team_id) where revoked_at is null;
create unique index team_access_codes_active_digest_uidx on public.team_access_codes(code_digest) where revoked_at is null;

create table public.team_join_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  access_code_id uuid not null references public.team_access_codes(id),
  requester_id uuid not null references auth.users(id) on delete cascade,
  requested_role_id text not null references public.roles(id),
  status text not null default 'pending' check (status in ('pending','approved','denied','cancelled')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  decision_note text,
  constraint team_join_requests_non_owner_role check (requested_role_id <> 'owner')
);
create unique index team_join_requests_one_pending_per_user_team_idx on public.team_join_requests(team_id, requester_id) where status = 'pending';
create index team_join_requests_team_status_idx on public.team_join_requests(team_id, status, requested_at desc);

alter table public.team_access_codes enable row level security;
alter table public.team_join_requests enable row level security;
revoke all on public.team_access_codes, public.team_join_requests from anon, authenticated;

create or replace function public.can_manage_team_join_requests(target_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or public.is_team_owner(target_team_id);
$$;

create or replace function public.create_or_regenerate_team_access_code(target_team_id uuid, plaintext_code text, expires_at_input timestamptz default null)
returns table (code_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare normalized_code text; canonical_digest text; new_id uuid;
begin
  if not public.can_manage_team_join_requests(target_team_id) then raise exception 'Team Owner or Platform Admin access is required.'; end if;
  normalized_code := upper(regexp_replace(coalesce(plaintext_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(normalized_code) < 8 or length(normalized_code) > 32 then raise exception 'Access code must be 8 to 32 letters or numbers.'; end if;
  if expires_at_input is not null and expires_at_input <= now() then raise exception 'Access code expiration must be in the future.'; end if;
  canonical_digest := encode(digest(normalized_code, 'sha256'), 'hex');
  if exists (select 1 from public.team_access_codes where code_digest = canonical_digest and revoked_at is null and team_id <> target_team_id) then raise exception 'This access code is already in use by another team.'; end if;
  update public.team_access_codes set revoked_at = now(), regenerated_at = now() where team_id = target_team_id and revoked_at is null;
  insert into public.team_access_codes(team_id, code_hash, code_digest, expires_at, created_by)
    values (target_team_id, crypt(normalized_code, gen_salt('bf')), canonical_digest, expires_at_input, (select auth.uid())) returning id into new_id;
  return query select new_id, expires_at_input;
end; $$;

create or replace function public.request_team_access(access_code_input text, requested_role_input text)
returns public.team_join_requests
language plpgsql security definer set search_path = public as $$
declare caller_id uuid := (select auth.uid()); code public.team_access_codes%rowtype; result public.team_join_requests%rowtype; normalized_code text; canonical_digest text;
begin
  if caller_id is null then raise exception 'Sign in is required to request team access.'; end if;
  normalized_code := upper(regexp_replace(coalesce(access_code_input, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(normalized_code) < 8 or length(normalized_code) > 32 then raise exception 'That access code is invalid, expired, or no longer active.'; end if;
  canonical_digest := encode(digest(normalized_code, 'sha256'), 'hex');
  select * into code from public.team_access_codes where revoked_at is null and (expires_at is null or expires_at > now()) and code_digest = canonical_digest and code_hash = crypt(normalized_code, code_hash) limit 1;
  if not found then raise exception 'That access code is invalid, expired, or no longer active.'; end if;
  if requested_role_input = 'owner' or not exists (select 1 from public.roles where id = requested_role_input) then raise exception 'Choose a valid non-owner team role.'; end if;
  if exists (select 1 from public.team_memberships where team_id = code.team_id and user_id = caller_id and status = 'active') then raise exception 'You already have access to this team.'; end if;
  insert into public.team_join_requests(team_id, access_code_id, requester_id, requested_role_id) values (code.team_id, code.id, caller_id, requested_role_input)
    on conflict (team_id, requester_id) where status = 'pending' do nothing returning * into result;
  if result.id is null then raise exception 'You already have a pending request for this team.'; end if;
  return result;
end; $$;

create or replace function public.decide_team_join_request(target_request_id uuid, approve boolean, note text default null)
returns public.team_join_requests
language plpgsql security definer set search_path = public as $$
declare request_row public.team_join_requests%rowtype;
begin
  select * into request_row from public.team_join_requests where id = target_request_id for update;
  if not found then raise exception 'Join request not found.'; end if;
  if not public.can_manage_team_join_requests(request_row.team_id) then raise exception 'Team Owner or Platform Admin access is required.'; end if;
  if request_row.status <> 'pending' then raise exception 'This join request has already been decided.'; end if;
  update public.team_join_requests set status = case when approve then 'approved' else 'denied' end, decided_at = now(), decided_by = (select auth.uid()), decision_note = nullif(trim(note), '') where id = request_row.id returning * into request_row;
  if approve then insert into public.team_memberships(team_id, user_id, role_id, status, invited_by) values (request_row.team_id, request_row.requester_id, request_row.requested_role_id, 'active', (select auth.uid())) on conflict (team_id, user_id) do update set role_id = excluded.role_id, status = 'active', invited_by = excluded.invited_by, updated_at = now(); end if;
  return request_row;
end; $$;

revoke all on function public.can_manage_team_join_requests(uuid), public.create_or_regenerate_team_access_code(uuid, text, timestamptz), public.request_team_access(text, text), public.decide_team_join_request(uuid, boolean, text) from public, anon;
grant execute on function public.create_or_regenerate_team_access_code(uuid, text, timestamptz), public.request_team_access(text, text), public.decide_team_join_request(uuid, boolean, text) to authenticated;
