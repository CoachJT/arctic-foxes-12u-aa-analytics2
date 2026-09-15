-- PR36 forward-only final beta usage tracking contract.
create table public.beta_usage_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  ended_at timestamptz,
  active_seconds integer not null default 0 check (active_seconds >= 0),
  constraint beta_usage_sessions_order check (ended_at is null or ended_at >= started_at)
);
create unique index beta_usage_sessions_one_open_per_user on public.beta_usage_sessions(user_id) where ended_at is null;
create index beta_usage_sessions_user_date on public.beta_usage_sessions(user_id, started_at desc);
alter table public.beta_usage_sessions enable row level security;
revoke all on public.beta_usage_sessions from anon, authenticated;

create or replace function public.beta_usage_heartbeat()
returns void language plpgsql security definer set search_path = public as $$
declare active_user uuid := (select auth.uid());
begin
  if active_user is null then raise exception 'Sign in is required.'; end if;
  if not exists (select 1 from public.team_memberships m join public.teams t on t.id = m.team_id where m.user_id = active_user and m.status = 'active' and t.beta_status in ('beta_team', 'early_adopter')) then return; end if;
  update public.beta_usage_sessions set active_seconds = active_seconds + least(60, greatest(0, extract(epoch from now() - last_heartbeat_at)::integer)), last_heartbeat_at = now() where user_id = active_user and ended_at is null and last_heartbeat_at >= now() - interval '2 minutes';
  if not found then update public.beta_usage_sessions set ended_at = last_heartbeat_at where user_id = active_user and ended_at is null; insert into public.beta_usage_sessions(user_id) values (active_user) on conflict (user_id) where ended_at is null do nothing; end if;
end; $$;

create or replace function public.admin_list_beta_usage()
returns table(user_id uuid, display_name text, total_active_hours numeric, active_hours_this_week numeric, last_active timestamptz, active_days bigint, days_since_joining_beta bigint)
language sql stable security definer set search_path = public as $$
  with beta_users as (
    select p.id as user_id, p.display_name, min(m.created_at::date) as first_joined_at
    from public.profiles p join public.team_memberships m on m.user_id = p.id and m.status = 'active'
    join public.teams t on t.id = m.team_id and t.beta_status in ('beta_team', 'early_adopter')
    group by p.id, p.display_name
  ), user_usage as (
    select s.user_id, round(coalesce(sum(s.active_seconds), 0) / 3600.0, 2) as total_active_hours,
      round(coalesce(sum(s.active_seconds) filter (where s.started_at >= date_trunc('week', now())), 0) / 3600.0, 2) as active_hours_this_week,
      max(s.last_heartbeat_at) as last_active, count(distinct s.started_at::date) as active_days
    from public.beta_usage_sessions s group by s.user_id
  )
  select bu.user_id, bu.display_name, coalesce(uu.total_active_hours, 0.00), coalesce(uu.active_hours_this_week, 0.00), uu.last_active, coalesce(uu.active_days, 0), greatest(0, current_date - bu.first_joined_at)
  from beta_users bu left join user_usage uu on uu.user_id = bu.user_id
  where (select auth.uid()) is not null and public.is_platform_admin()
  order by uu.last_active desc nulls last, bu.display_name;
$$;
revoke all on function public.beta_usage_heartbeat(), public.admin_list_beta_usage() from public, anon;
grant execute on function public.beta_usage_heartbeat(), public.admin_list_beta_usage() to authenticated;
