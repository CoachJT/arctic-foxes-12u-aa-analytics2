-- Shot Intelligence v1: canonical shot-event foundation.
-- Additive only. Manual, film, and automated producers write the same model.
-- Coordinate contract: x is the rink length axis and y is the rink width axis.
-- The origin is the rink centre; x is [-100, 100] feet toward the attacking
-- net and y is [-42.5, 42.5] feet from the rink centre line. raw_* preserves
-- the captured orientation; normalized_* points toward the attacking net.

create table public.shot_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  game_id uuid not null references public.team_games(id) on delete cascade,
  shooting_team_id uuid references public.teams(id) on delete set null,
  is_opponent_event boolean not null default false,
  opponent_team_name text,
  shooter_player_id uuid references public.team_roster_players(id) on delete set null,
  shooter_display_name text,
  shooter_jersey_number text,
  goalie_player_id uuid references public.team_roster_players(id) on delete set null,
  goalie_display_name text,
  period smallint not null check (period between 1 and 10),
  game_clock_seconds integer check (game_clock_seconds between 0 and 3600),
  video_timestamp_seconds numeric check (video_timestamp_seconds is null or video_timestamp_seconds >= 0),
  raw_x numeric not null check (raw_x between -100 and 100),
  raw_y numeric not null check (raw_y between -42.5 and 42.5),
  normalized_x numeric not null check (normalized_x between -100 and 100),
  normalized_y numeric not null check (normalized_y between -42.5 and 42.5),
  result text not null check (result in ('GOAL', 'SAVE', 'MISS', 'BLOCK')),
  shot_type text check (shot_type is null or shot_type in ('WRIST', 'SLAP', 'SNAP', 'BACKHAND', 'TIP', 'DEFLECTION', 'OTHER')),
  strength_state text,
  source text not null default 'manual' check (source in ('manual', 'film', 'automated')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text,
  created_by uuid default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  check (is_opponent_event or shooting_team_id = team_id),
  check (not is_opponent_event or shooting_team_id is null),
  check (is_opponent_event or shooter_display_name is null and shooter_jersey_number is null),
  check (is_opponent_event or opponent_team_name is null),
  check (is_opponent_event or goalie_display_name is null),
  check (is_opponent_event or shooter_player_id is not null or shooter_display_name is null),
  check (is_opponent_event or shooting_team_id is not null),
  check (is_opponent_event or goalie_player_id is null or goalie_player_id <> shooter_player_id)
);

create index shot_events_team_season_idx on public.shot_events(team_id, season_id, created_at);
create index shot_events_game_idx on public.shot_events(game_id, period, created_at);
create index shot_events_shooter_idx on public.shot_events(shooter_player_id, season_id);
create index shot_events_goalie_idx on public.shot_events(goalie_player_id, season_id);
create index shot_events_opponent_idx on public.shot_events(team_id, opponent_team_name, season_id);
create index shot_events_result_idx on public.shot_events(team_id, result, season_id);
create index shot_events_period_idx on public.shot_events(team_id, period, season_id);

-- Idempotency is tenant+key scoped, not global, and excludes voided rows so a
-- coach can void a mistaken entry and resubmit with the same client-generated
-- key without being permanently blocked. Consecutive legitimate shots must
-- use distinct keys (or omit the key) and remain separate events.
create unique index shot_events_idempotency_idx
  on public.shot_events(team_id, idempotency_key)
  where idempotency_key is not null and voided_at is null;

create or replace function public.validate_shot_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  game_team uuid;
  game_season uuid;
  game_organization uuid;
  team_organization uuid;
begin
  select game.team_id, game.season_id, team.organization_id
    into game_team, game_season, game_organization
  from public.team_games game
  join public.teams team on team.id = game.team_id
  where game.id = new.game_id;
  if game_team is null or game_team <> new.team_id then
    raise exception 'The selected game does not belong to this team.';
  end if;
  select team.organization_id into team_organization
  from public.teams team where team.id = new.team_id;
  if team_organization is null or new.organization_id <> team_organization
     or game_organization <> new.organization_id then
    raise exception 'The selected organization does not own this team and game.';
  end if;
  if new.season_id is not null and not exists (
    select 1 from public.seasons season
    where season.id = new.season_id and season.team_id = new.team_id
  ) then
    raise exception 'The selected season does not belong to this team.';
  end if;
  if new.season_id is not null and game_season is not null and new.season_id <> game_season then
    raise exception 'The selected game does not belong to this season.';
  end if;
  if new.shooting_team_id is not null and new.shooting_team_id <> new.team_id
     and not new.is_opponent_event then
    raise exception 'A managed shooting team must be the workspace team.';
  end if;
  if new.shooter_player_id is not null and not exists (
    select 1 from public.team_roster_players player
    where player.id = new.shooter_player_id and player.team_id = new.team_id
  ) then
    raise exception 'The shooter does not belong to this team.';
  end if;
  if new.goalie_player_id is not null and not exists (
    select 1 from public.team_roster_players player
    where player.id = new.goalie_player_id and player.team_id = new.team_id
  ) then
    raise exception 'The goalie does not belong to this team.';
  end if;
  if new.source = 'automated' and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Automated shot events can only be written by a trusted service.';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

create trigger shot_events_validate
before insert or update on public.shot_events
for each row execute function public.validate_shot_event();

create or replace view public.shot_event_read_model
with (security_invoker = true)
as
select
  event.*,
  (event.result in ('GOAL', 'SAVE')) as is_sog,
  case
    when event.normalized_x >= 80 and abs(event.normalized_y) <= 8 then 'CREASE'
    when event.normalized_x >= 60 and abs(event.normalized_y) <= 18 then 'LOW_SLOT'
    when event.normalized_x >= 35 and event.normalized_y < -18 then 'LEFT_CIRCLE'
    when event.normalized_x >= 35 and event.normalized_y > 18 then 'RIGHT_CIRCLE'
    when event.normalized_x < 35 and event.normalized_y < -18 then 'LEFT_POINT'
    when event.normalized_x < 35 and event.normalized_y > 18 then 'RIGHT_POINT'
    when event.normalized_x < 35 and event.normalized_y < 0 then 'LEFT_LOW'
    when event.normalized_x < 35 and event.normalized_y >= 0 then 'RIGHT_LOW'
    else 'OTHER'
  end as zone
from public.shot_events event
where event.voided_at is null;

create or replace view public.shot_event_game_reconciliation
with (security_invoker = true)
as
select
  game.team_id,
  game.season_id,
  game.id as game_id,
  game.source_game_id,
  stats.shots_for,
  stats.shots_against,
  count(*) filter (where event.is_opponent_event = false) as recorded_shots_for,
  count(*) filter (where event.is_opponent_event = true) as recorded_shots_against,
  -- Completeness is computed per metric and combined with MISMATCH taking
  -- priority over PARTIAL: an excess of recorded events over the canonical
  -- total is a data-integrity contradiction (e.g. a duplicate or a bad
  -- canonical entry), and must never be silently folded into the same
  -- bucket as an ordinary, expected undercount from partial manual entry.
  case
    when stats.shots_for is null and stats.shots_against is null then 'UNKNOWN'
    when (stats.shots_for is not null and count(*) filter (where event.is_opponent_event = false) > stats.shots_for)
      or (stats.shots_against is not null and count(*) filter (where event.is_opponent_event = true) > stats.shots_against)
      then 'MISMATCH'
    when (stats.shots_for is null or stats.shots_for = count(*) filter (where event.is_opponent_event = false))
     and (stats.shots_against is null or stats.shots_against = count(*) filter (where event.is_opponent_event = true))
      then 'COMPLETE'
    else 'PARTIAL'
  end as completeness,
  case
    when stats.shots_for is not null
     and stats.shots_for <> count(*) filter (where event.is_opponent_event = false)
      then 'SHOT_TOTAL_MISMATCH'
    when stats.shots_against is not null
     and stats.shots_against <> count(*) filter (where event.is_opponent_event = true)
      then 'SHOT_TOTAL_MISMATCH'
    else null
  end as mismatch_status
from public.team_games game
left join public.team_game_team_stats stats
  on stats.team_id = game.team_id and stats.source_game_id = game.source_game_id
left join public.shot_event_read_model event on event.game_id = game.id
group by game.team_id, game.season_id, game.id, game.source_game_id,
  stats.shots_for, stats.shots_against;

create or replace function public.shot_zone_summary(
  target_team_id uuid,
  target_season_id uuid default null,
  target_player_id uuid default null,
  target_goalie_id uuid default null,
  target_opponent text default null,
  from_date date default null,
  to_date date default null
)
returns table (
  zone text,
  attempts bigint,
  sog bigint,
  goals bigint,
  saves bigint,
  shooting_percentage numeric,
  sample_completeness text
)
language sql
stable
security invoker
set search_path = public
as $$
  select model.zone,
    count(*) as attempts,
    count(*) filter (where model.is_sog) as sog,
    count(*) filter (where model.result = 'GOAL') as goals,
    count(*) filter (where model.result = 'SAVE') as saves,
    case when count(*) filter (where model.is_sog) = 0 then null
      else round(100.0 * count(*) filter (where model.result = 'GOAL')
        / count(*) filter (where model.is_sog), 2) end,
    case when bool_or(reconciliation.completeness = 'MISMATCH') then 'MISMATCH'
      when bool_and(reconciliation.completeness = 'COMPLETE') then 'COMPLETE'
      when bool_or(reconciliation.completeness = 'PARTIAL') then 'PARTIAL'
      else 'UNKNOWN' end
  from public.shot_event_read_model model
  left join public.shot_event_game_reconciliation reconciliation
    on reconciliation.game_id = model.game_id
  where model.team_id = target_team_id
    and (target_season_id is null or model.season_id = target_season_id)
    and (target_player_id is null or model.shooter_player_id = target_player_id)
    and (target_goalie_id is null or model.goalie_player_id = target_goalie_id)
    and (target_opponent is null or model.opponent_team_name = target_opponent)
    and (from_date is null or model.created_at::date >= from_date)
    and (to_date is null or model.created_at::date <= to_date)
  group by model.zone
  order by model.zone;
$$;

alter table public.shot_events enable row level security;
revoke all on public.shot_events from anon;
grant select, insert, update on public.shot_events to authenticated;
grant select on public.shot_event_read_model, public.shot_event_game_reconciliation to authenticated;
grant execute on function public.shot_zone_summary(uuid, uuid, uuid, uuid, text, date, date) to authenticated;

create policy shot_events_select
on public.shot_events for select to authenticated
using (public.has_team_capability(team_id, 'stats.view'));

create policy shot_events_insert
on public.shot_events for insert to authenticated
with check (
  public.has_team_capability(team_id, 'stats.edit')
  and source <> 'automated'
  and created_by = (select auth.uid())
);

create policy shot_events_update
on public.shot_events for update to authenticated
using (public.has_team_capability(team_id, 'stats.edit'))
with check (
  public.has_team_capability(team_id, 'stats.edit')
  and source <> 'automated'
);
