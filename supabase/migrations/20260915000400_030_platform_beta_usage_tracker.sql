-- Draft-only, additive beta usage tracker. Heartbeats are accepted only for beta users
-- while visible and active; coaches cannot read the underlying session rows or totals.
create table public.beta_usage_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(), last_heartbeat_at timestamptz not null default now(), ended_at timestamptz,
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
  if not exists (select 1 from public.team_memberships m join public.teams t on t.id=m.team_id where m.user_id=active_user and m.status='active' and t.beta_status in ('beta_team','early_adopter')) then return; end if;
  update public.beta_usage_sessions set active_seconds = active_seconds + least(60, greatest(0, extract(epoch from now()-last_heartbeat_at)::integer)), last_heartbeat_at=now()
    where user_id=active_user and ended_at is null and last_heartbeat_at >= now()-interval '2 minutes';
  if not found then
    update public.beta_usage_sessions set ended_at=last_heartbeat_at where user_id=active_user and ended_at is null;
    insert into public.beta_usage_sessions(user_id) values(active_user) on conflict (user_id) where ended_at is null do nothing;
  end if;
end; $$;

create or replace function public.admin_list_beta_usage()
returns table(user_id uuid, display_name text, total_active_hours numeric, active_hours_this_week numeric, last_active timestamptz, active_days bigint, days_since_joining_beta bigint)
language sql stable security definer set search_path=public as $$
  select p.id, p.display_name, round(coalesce(sum(s.active_seconds),0)/3600.0,2), round(coalesce(sum(s.active_seconds) filter(where s.started_at >= date_trunc('week',now())),0)/3600.0,2), max(s.last_heartbeat_at), count(distinct s.started_at::date), greatest(0,(current_date-min(m.created_at::date)))
  from public.profiles p join public.team_memberships m on m.user_id=p.id and m.status='active' join public.teams t on t.id=m.team_id and t.beta_status in ('beta_team','early_adopter') left join public.beta_usage_sessions s on s.user_id=p.id
  where public.is_platform_admin() group by p.id,p.display_name;
$$;
revoke all on function public.beta_usage_heartbeat(), public.admin_list_beta_usage() from public, anon;
grant execute on function public.beta_usage_heartbeat(), public.admin_list_beta_usage() to authenticated;
