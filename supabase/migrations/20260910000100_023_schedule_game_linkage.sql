-- 023: season-scope schedule rows and make Schedule -> Game Center linkage
-- canonical via eager game-shell creation.
--
-- Forward-only and additive. No row is deleted, no column is dropped or
-- retyped, and no existing function is removed. Electron sync keeps working
-- unchanged: it still upserts team_schedule_games on
-- (team_id, source_schedule_id) and team_games on (team_id, source_game_id),
-- and it may continue to write linked_game_source_id itself.
--
-- Design decision (eager shells): adding a schedule game immediately creates
-- exactly one canonical team_games row so Game Center shows it right away.
-- "A shell exists" therefore no longer implies "a game was played". Played is
-- derived from the presence of a team_game_team_stats row -- never from the
-- existence of the team_games row itself.

-- 1. Season scoping ---------------------------------------------------------
-- Nullable on purpose. A wrong season is worse than an absent one, so rows
-- that cannot be attributed unambiguously stay null.
alter table public.team_schedule_games
  add column if not exists season_id uuid
  references public.seasons(id) on delete set null;

create index if not exists team_schedule_games_team_season_idx
  on public.team_schedule_games(team_id, season_id);

-- 2. Conservative backfill --------------------------------------------------
-- Only teams that own exactly ONE season can be attributed automatically.
-- Multi-season teams are deliberately skipped and left for an operator.
update public.team_schedule_games s
set season_id = only_season.season_id
from (
  -- array_agg indexing rather than min(): Postgres has no min(uuid) aggregate.
  -- The having clause guarantees exactly one element.
  select team_id, (array_agg(id))[1] as season_id
  from public.seasons
  group by team_id
  having count(*) = 1
) as only_season
where s.team_id = only_season.team_id
  and s.season_id is null;

-- 3. Team/season integrity for schedule rows --------------------------------
-- Mirrors validate_team_game_season() from migration 016 so a schedule row can
-- never reference another team's season, even on a direct table write.
create or replace function public.validate_team_schedule_game_season()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.season_id is not null and not exists (
    select 1 from public.seasons season
    where season.id = new.season_id
      and season.team_id = new.team_id
  ) then
    raise exception 'The selected season does not belong to this team.';
  end if;
  return new;
end;
$$;

drop trigger if exists team_schedule_games_validate_season on public.team_schedule_games;
create trigger team_schedule_games_validate_season
before insert or update of season_id, team_id on public.team_schedule_games
for each row execute function public.validate_team_schedule_game_season();

-- 4. Relationship protection for the canonical link -------------------------
-- linked_game_source_id already exists and is already written by the Windows
-- sync. This only guarantees it points at a real game on the SAME team. It is
-- intentionally not a foreign key: team_games is keyed by
-- (team_id, source_game_id), not by source_game_id alone.
create or replace function public.validate_schedule_game_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.linked_game_source_id is not null and not exists (
    select 1 from public.team_games game
    where game.team_id = new.team_id
      and game.source_game_id = new.linked_game_source_id
  ) then
    raise exception 'The linked game does not belong to this team.';
  end if;
  return new;
end;
$$;

drop trigger if exists team_schedule_games_validate_link on public.team_schedule_games;
create trigger team_schedule_games_validate_link
before insert or update of linked_game_source_id, team_id on public.team_schedule_games
for each row execute function public.validate_schedule_game_link();

-- 5. One canonical game may be claimed by at most one schedule row ----------
-- Partial so the many legitimately-null links stay legal. Same-day
-- doubleheaders are unaffected: they link to two DIFFERENT games.
create unique index if not exists team_schedule_games_unique_link_idx
  on public.team_schedule_games(team_id, linked_game_source_id)
  where linked_game_source_id is not null;

-- 6. Missing DELETE policy --------------------------------------------------
-- Schedule delete was previously blocked by RLS regardless of the client. The
-- linked team_games row is intentionally NOT cascaded: it may already carry
-- stats, and destroying scored history from a schedule action would be unsafe.
drop policy if exists team_schedule_games_delete on public.team_schedule_games;
create policy team_schedule_games_delete on public.team_schedule_games
  for delete using (public.has_team_capability(team_id, 'schedule.edit'));

-- 7. Eager, idempotent, concurrency-safe canonical shell creation -----------
-- Returns the canonical source_game_id for a schedule row, creating the shell
-- on first call. Safe to call repeatedly and in parallel for the same row.
create or replace function public.ensure_schedule_game_shell(
  target_schedule_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  sched public.team_schedule_games%rowtype;
  canonical_id text;
begin
  if target_schedule_id is null then
    raise exception 'A schedule entry is required.';
  end if;

  -- Row lock: concurrent callers for the same schedule row serialize here, so
  -- only the first can create the shell. The others block, then observe the
  -- link the winner wrote and return it. This is what makes a double-click or
  -- a retry incapable of producing a second game.
  select * into sched
  from public.team_schedule_games
  where id = target_schedule_id
  for update;

  if not found then
    raise exception 'The schedule entry was not found.';
  end if;

  -- Server-side authorization, re-validated regardless of client claims. The
  -- caller must be able to edit BOTH the schedule and games for this team.
  if not public.has_team_capability(sched.team_id, 'schedule.edit') then
    raise exception 'You are not authorized to edit this team schedule.';
  end if;
  if not public.has_team_capability(sched.team_id, 'games.edit') then
    raise exception 'You are not authorized to create games for this team.';
  end if;

  -- Already linked: return the existing canonical game unchanged.
  if sched.linked_game_source_id is not null then
    return sched.linked_game_source_id;
  end if;

  -- Identity derives from the schedule row itself, never from (date,
  -- opponent). Two games on the same date against the same opponent are two
  -- schedule rows and therefore two distinct shells.
  canonical_id := sched.source_schedule_id;

  -- If a game with this canonical id already exists (a retry that failed
  -- after the insert, or an Electron row that already used this id), adopt it
  -- rather than creating a duplicate.
  insert into public.team_games (team_id, source_game_id, season_id, date, opponent)
  values (sched.team_id, canonical_id, sched.season_id, sched.date, sched.opponent)
  on conflict (team_id, source_game_id) do nothing;

  update public.team_schedule_games
  set linked_game_source_id = canonical_id,
      updated_at = now()
  where id = sched.id;

  return canonical_id;
end;
$$;

revoke all on function public.ensure_schedule_game_shell(uuid) from public;
grant execute on function public.ensure_schedule_game_shell(uuid) to authenticated;

-- 7b. Atomic schedule edit with linked-game propagation -----------------------
-- Editing a schedule row must keep its canonical game consistent (date,
-- opponent AND season). Doing that as two independent client writes can leave
-- the rows divergent if the second fails, and would let a schedule-only editor
-- mutate a game row they are not authorized to edit.
--
-- Authorization model (verified against role_permissions, not assumed):
--   schedule.edit does NOT imply games.edit. The 'assistant' role holds
--   schedule.edit + games.view but NOT games.edit. Therefore any write that
--   reaches team_games is gated on games.edit separately and explicitly.
--
-- Everything below runs in the function's single implicit transaction, so the
-- schedule row and its linked game either both change or neither does.
create or replace function public.save_schedule_game(
  target_schedule_id uuid,
  new_date date,
  new_opponent text,
  new_time time default null,
  new_home_away text default 'Home',
  new_game_type text default 'League',
  new_location text default '',
  new_notes text default '',
  new_season_id uuid default null
)
returns public.team_schedule_games
language plpgsql
security definer
set search_path = public
as $$
declare
  sched public.team_schedule_games%rowtype;
  updated public.team_schedule_games%rowtype;
  effective_season uuid;
begin
  if target_schedule_id is null then
    raise exception 'The game to edit could not be identified.';
  end if;
  if new_date is null then
    raise exception 'Choose the game date.';
  end if;
  if new_opponent is null or length(trim(new_opponent)) = 0 then
    raise exception 'Enter the opponent.';
  end if;

  -- Lock the schedule row so a concurrent edit or shell resolution cannot
  -- interleave and leave the pair divergent.
  select * into sched
  from public.team_schedule_games
  where id = target_schedule_id
  for update;

  if not found then
    raise exception 'That game was not found on this team.';
  end if;

  -- Always required to touch the schedule row at all.
  if not public.has_team_capability(sched.team_id, 'schedule.edit') then
    raise exception 'You do not have schedule editing access.';
  end if;

  -- Season correction is supported, but the season must belong to this team.
  -- Passing null means "leave the season unchanged" rather than "clear it", so
  -- a client that omits the argument can never silently unscope a row.
  effective_season := coalesce(new_season_id, sched.season_id);
  if effective_season is not null and not exists (
    select 1 from public.seasons season
    where season.id = effective_season
      and season.team_id = sched.team_id
  ) then
    raise exception 'The selected season does not belong to this team.';
  end if;

  -- Any propagation into team_games is a games.edit action, enforced here
  -- rather than inherited from schedule.edit.
  if sched.linked_game_source_id is not null then
    if not public.has_team_capability(sched.team_id, 'games.edit') then
      raise exception 'You do not have game editing access for the linked game.';
    end if;

    -- The linked game must belong to the same team. source_game_id is never
    -- rewritten, so stats keyed to it stay attached.
    if not exists (
      select 1 from public.team_games game
      where game.team_id = sched.team_id
        and game.source_game_id = sched.linked_game_source_id
    ) then
      raise exception 'The linked game does not belong to this team.';
    end if;

    update public.team_games
    set date = new_date,
        opponent = trim(new_opponent),
        season_id = effective_season,
        updated_at = now()
    where team_id = sched.team_id
      and source_game_id = sched.linked_game_source_id;
  end if;

  update public.team_schedule_games
  set date = new_date,
      opponent = trim(new_opponent),
      time = new_time,
      home_away = case when new_home_away = 'Away' then 'Away' else 'Home' end,
      game_type = coalesce(nullif(trim(new_game_type), ''), 'League'),
      location = coalesce(new_location, ''),
      notes = coalesce(new_notes, ''),
      season_id = effective_season,
      updated_at = now()
  where id = sched.id
  returning * into updated;

  return updated;
end;
$$;

revoke all on function public.save_schedule_game(uuid, date, text, time, text, text, text, text, uuid) from public;
grant execute on function public.save_schedule_game(uuid, date, text, time, text, text, text, text, uuid) to authenticated;

-- 8. Played vs scheduled ----------------------------------------------------
-- Derived, never stored, so a shell can never drift into looking completed.
-- has_stats is the canonical "this game was played" predicate; is_eligible
-- mirrors the date rule save_game_stats already enforces.
create or replace view public.team_games_with_status
with (security_invoker = true)
as
select
  g.*,
  exists (
    select 1 from public.team_game_team_stats t
    where t.team_id = g.team_id
      and t.source_game_id = g.source_game_id
  ) as has_stats,
  (g.date <= current_date) as is_eligible
from public.team_games g;

grant select on public.team_games_with_status to authenticated;

-- 9. Backfill links for existing production rows ----------------------------
-- Only the unambiguous case: exactly one schedule row and exactly one game row
-- share a (team_id, date, opponent), the schedule row is not yet linked, and
-- the game is not already claimed. The 2026-08-29 doubleheader is safe here
-- because its two rows carry distinct opponent labels; anything genuinely
-- ambiguous is skipped by the count(*) = 1 guards rather than guessed.
with candidate as (
  select s.id as schedule_id, g.source_game_id
  from public.team_schedule_games s
  join public.team_games g
    on g.team_id = s.team_id
   and g.date = s.date
   and g.opponent = s.opponent
  where s.linked_game_source_id is null
    and not exists (
      select 1 from public.team_schedule_games other
      where other.team_id = s.team_id
        and other.linked_game_source_id = g.source_game_id
    )
), unambiguous as (
  select schedule_id, (array_agg(source_game_id))[1] as source_game_id
  from candidate
  group by schedule_id
  having count(*) = 1
), one_claim as (
  select source_game_id, (array_agg(schedule_id))[1] as schedule_id
  from unambiguous
  group by source_game_id
  having count(*) = 1
)
update public.team_schedule_games s
set linked_game_source_id = one_claim.source_game_id,
    updated_at = now()
from one_claim
where s.id = one_claim.schedule_id;
