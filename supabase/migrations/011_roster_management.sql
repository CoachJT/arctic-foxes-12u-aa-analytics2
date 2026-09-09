-- Stage F roster management.
-- Additive only: existing roster rows and historical stat references remain intact.

alter table public.team_roster_players
  add column if not exists season_id uuid references public.seasons(id) on delete set null,
  add column if not exists first_name text not null default '',
  add column if not exists last_name text not null default '',
  add column if not exists player_type text not null default 'skater',
  add column if not exists shoots text not null default 'unknown',
  add column if not exists notes text not null default '',
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;
update public.team_roster_players
set
  first_name = case
    when position(' ' in trim(name)) > 0 then split_part(trim(name), ' ', 1)
    else trim(name)
  end,
  last_name = case
    when position(' ' in trim(name)) > 0 then regexp_replace(trim(name), '^\S+\s+', '')
    else ''
  end
where first_name = '' and last_name = '';
update public.team_roster_players
set player_type = 'goalie'
where position = 'G' and player_type = 'skater';
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_roster_players'::regclass
      and conname = 'team_roster_players_player_type_check'
  ) then
    alter table public.team_roster_players
      add constraint team_roster_players_player_type_check
      check (player_type in ('skater', 'goalie'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_roster_players'::regclass
      and conname = 'team_roster_players_shoots_check'
  ) then
    alter table public.team_roster_players
      add constraint team_roster_players_shoots_check
      check (shoots in ('L', 'R', 'unknown'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.team_roster_players'::regclass
      and conname = 'team_roster_players_status_check'
  ) then
    alter table public.team_roster_players
      add constraint team_roster_players_status_check
      check (status in ('active', 'inactive'));
  end if;
end;
$$;
create index if not exists team_roster_players_team_season_status_idx
  on public.team_roster_players(team_id, season_id, status);
create or replace function public.normalize_team_roster_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.team_id <> old.team_id then
    raise exception 'A roster player cannot be moved between teams.';
  end if;

  new.first_name := trim(coalesce(new.first_name, ''));
  new.last_name := trim(coalesce(new.last_name, ''));
  new.jersey_number := trim(coalesce(new.jersey_number, ''));
  if new.first_name = '' and new.last_name = '' and trim(coalesce(new.name, '')) <> '' then
    new.first_name := case
      when position(' ' in trim(new.name)) > 0 then split_part(trim(new.name), ' ', 1)
      else trim(new.name)
    end;
    new.last_name := case
      when position(' ' in trim(new.name)) > 0 then regexp_replace(trim(new.name), '^\S+\s+', '')
      else ''
    end;
  end if;
  new.position := upper(trim(coalesce(new.position, '')));
  new.player_type := lower(trim(coalesce(new.player_type, 'skater')));
  new.shoots := upper(trim(coalesce(new.shoots, 'unknown')));
  if new.shoots = '' then
    new.shoots := 'unknown';
  end if;
  new.notes := trim(coalesce(new.notes, ''));
  new.status := lower(trim(coalesce(new.status, 'active')));

  if new.first_name = '' or new.last_name = '' then
    raise exception 'First name and last name are required.';
  end if;
  if new.jersey_number !~ '^[0-9]{1,3}$' then
    raise exception 'Jersey number must be a one to three digit number.';
  end if;
  if new.player_type not in ('skater', 'goalie') then
    raise exception 'Player type must be skater or goalie.';
  end if;
  if new.position not in ('F', 'D', 'G') then
    raise exception 'Position must be F, D, or G.';
  end if;
  if new.player_type = 'goalie' and new.position <> 'G' then
    raise exception 'Goalies must use position G.';
  end if;
  if new.player_type = 'skater' and new.position = 'G' then
    raise exception 'Skaters cannot use position G.';
  end if;
  if new.shoots not in ('L', 'R', 'UNKNOWN') then
    raise exception 'Shoots must be L, R, or unknown.';
  end if;
  if new.shoots = 'UNKNOWN' then
    new.shoots := 'unknown';
  end if;
  if new.status not in ('active', 'inactive') then
    raise exception 'Roster status must be active or inactive.';
  end if;

  if coalesce(new.source_player_id, '') = '' then
    new.source_player_id := gen_random_uuid()::text;
  end if;
  new.name := trim(concat_ws(' ', new.first_name, new.last_name));
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;
  return new;
end;
$$;
drop trigger if exists team_roster_players_normalize on public.team_roster_players;
create trigger team_roster_players_normalize
before insert or update on public.team_roster_players
for each row execute function public.normalize_team_roster_player();
drop policy if exists team_roster_players_select on public.team_roster_players;
create policy team_roster_players_select
on public.team_roster_players for select
to authenticated
using (public.has_workspace_feature_access(team_id, 'players.view', 'players'));
drop policy if exists team_roster_players_insert on public.team_roster_players;
create policy team_roster_players_insert
on public.team_roster_players for insert
to authenticated
with check (public.has_workspace_feature_access(team_id, 'players.evaluate', 'players'));
drop policy if exists team_roster_players_update on public.team_roster_players;
create policy team_roster_players_update
on public.team_roster_players for update
to authenticated
using (public.has_workspace_feature_access(team_id, 'players.evaluate', 'players'))
with check (public.has_workspace_feature_access(team_id, 'players.evaluate', 'players'));
revoke delete on public.team_roster_players from authenticated, anon;
grant select, insert, update on public.team_roster_players to authenticated;
