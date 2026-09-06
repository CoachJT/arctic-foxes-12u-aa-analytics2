-- Phase 1 team-data sync tables.
-- These tables are additive cloud projections of the Windows app data.
-- The Windows app remains the source of truth.

create table public.team_roster_players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  source_player_id text not null,
  jersey_number text not null,
  name text not null,
  position text not null check (position in ('F', 'D', 'G')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, source_player_id)
);

create index team_roster_players_team_idx
  on public.team_roster_players(team_id);

create table public.team_schedule_games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  source_schedule_id text not null,
  date date not null,
  time time,
  opponent text not null,
  home_away text not null,
  game_type text not null,
  location text not null default '',
  notes text not null default '',
  linked_game_source_id text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, source_schedule_id)
);

create index team_schedule_games_team_date_idx
  on public.team_schedule_games(team_id, date);

create table public.team_games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  source_game_id text not null,
  date date not null,
  opponent text not null,
  period_length_min numeric,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, source_game_id)
);

create index team_games_team_date_idx
  on public.team_games(team_id, date);

create table public.team_game_player_stats (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  source_game_id text not null,
  source_player_id text not null,
  player_type text not null check (player_type in ('skater', 'goalie')),
  gp numeric,
  goals numeric,
  assists numeric,
  shots numeric,
  penalty_minutes numeric,
  plus_minus numeric,
  blocks numeric,
  faceoff_wins numeric,
  faceoff_losses numeric,
  faceoff_attempts numeric,
  power_play_goals numeric,
  power_play_assists numeric,
  power_play_points numeric,
  short_handed_goals numeric,
  short_handed_assists numeric,
  short_handed_points numeric,
  game_winning_goals numeric,
  game_tying_goals numeric,
  takeaways numeric,
  giveaways numeric,
  chances numeric,
  toi_minutes numeric,
  minutes numeric,
  saves numeric,
  goals_against numeric,
  wins numeric,
  losses numeric,
  ties numeric,
  shutouts numeric,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, source_game_id, source_player_id, player_type)
);

create index team_game_player_stats_team_game_idx
  on public.team_game_player_stats(team_id, source_game_id);

create table public.team_game_team_stats (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  source_game_id text not null,
  goals_for numeric,
  goals_against numeric,
  shots_for numeric,
  shots_against numeric,
  power_play_chances numeric,
  power_play_success numeric,
  penalty_kill_chances numeric,
  penalty_kill_success numeric,
  faceoff_wins numeric,
  faceoff_losses numeric,
  goals_for_p1 numeric,
  goals_for_p2 numeric,
  goals_for_p3 numeric,
  goals_for_ot numeric,
  goals_against_p1 numeric,
  goals_against_p2 numeric,
  goals_against_p3 numeric,
  goals_against_ot numeric,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, source_game_id)
);

create index team_game_team_stats_team_game_idx
  on public.team_game_team_stats(team_id, source_game_id);

create table public.team_season_records (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  season_key text not null,
  games_played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  ties integer not null default 0,
  goals_for integer not null default 0,
  goals_against integer not null default 0,
  source_game_count integer not null default 0,
  computed_at timestamptz not null default now(),
  unique (team_id, season_key)
);

alter table public.team_roster_players enable row level security;
alter table public.team_schedule_games enable row level security;
alter table public.team_games enable row level security;
alter table public.team_game_player_stats enable row level security;
alter table public.team_game_team_stats enable row level security;
alter table public.team_season_records enable row level security;

create policy team_roster_players_select
on public.team_roster_players for select
to authenticated
using (public.has_team_capability(team_id, 'players.view'));

create policy team_roster_players_insert
on public.team_roster_players for insert
to authenticated
with check (public.has_team_capability(team_id, 'players.evaluate'));

create policy team_roster_players_update
on public.team_roster_players for update
to authenticated
using (public.has_team_capability(team_id, 'players.evaluate'))
with check (public.has_team_capability(team_id, 'players.evaluate'));

create policy team_schedule_games_select
on public.team_schedule_games for select
to authenticated
using (public.has_team_capability(team_id, 'schedule.view'));

create policy team_schedule_games_insert
on public.team_schedule_games for insert
to authenticated
with check (public.has_team_capability(team_id, 'schedule.edit'));

create policy team_schedule_games_update
on public.team_schedule_games for update
to authenticated
using (public.has_team_capability(team_id, 'schedule.edit'))
with check (public.has_team_capability(team_id, 'schedule.edit'));

create policy team_games_select
on public.team_games for select
to authenticated
using (public.has_team_capability(team_id, 'games.view'));

create policy team_games_insert
on public.team_games for insert
to authenticated
with check (public.has_team_capability(team_id, 'games.edit'));

create policy team_games_update
on public.team_games for update
to authenticated
using (public.has_team_capability(team_id, 'games.edit'))
with check (public.has_team_capability(team_id, 'games.edit'));

create policy team_game_player_stats_select
on public.team_game_player_stats for select
to authenticated
using (public.has_team_capability(team_id, 'stats.view'));

create policy team_game_player_stats_insert
on public.team_game_player_stats for insert
to authenticated
with check (public.has_team_capability(team_id, 'stats.edit'));

create policy team_game_player_stats_update
on public.team_game_player_stats for update
to authenticated
using (public.has_team_capability(team_id, 'stats.edit'))
with check (public.has_team_capability(team_id, 'stats.edit'));

create policy team_game_team_stats_select
on public.team_game_team_stats for select
to authenticated
using (public.has_team_capability(team_id, 'stats.view'));

create policy team_game_team_stats_insert
on public.team_game_team_stats for insert
to authenticated
with check (public.has_team_capability(team_id, 'stats.edit'));

create policy team_game_team_stats_update
on public.team_game_team_stats for update
to authenticated
using (public.has_team_capability(team_id, 'stats.edit'))
with check (public.has_team_capability(team_id, 'stats.edit'));

create policy team_season_records_select
on public.team_season_records for select
to authenticated
using (public.has_team_capability(team_id, 'reports.view'));

create policy team_season_records_insert
on public.team_season_records for insert
to authenticated
with check (public.has_team_capability(team_id, 'stats.edit'));

create policy team_season_records_update
on public.team_season_records for update
to authenticated
using (public.has_team_capability(team_id, 'stats.edit'))
with check (public.has_team_capability(team_id, 'stats.edit'));

revoke all on public.team_roster_players,
  public.team_schedule_games,
  public.team_games,
  public.team_game_player_stats,
  public.team_game_team_stats,
  public.team_season_records
from anon;

grant select, insert, update on public.team_roster_players,
  public.team_schedule_games,
  public.team_games,
  public.team_game_player_stats,
  public.team_game_team_stats,
  public.team_season_records
to authenticated;
