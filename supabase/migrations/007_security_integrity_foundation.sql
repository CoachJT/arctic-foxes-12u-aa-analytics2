-- PuckNexus 2.0 Stage 1A security and integrity hardening.
-- Additive only: preserves existing data, identifiers, triggers, and RLS predicates.

-- Keep SECURITY DEFINER functions on a fixed schema search path and remove
-- direct API execution from maintenance/trigger functions.
do $$
declare
  target record;
begin
  for target in
    select
      p.proname,
      pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'prevent_final_owner_delete',
        'prevent_final_owner_loss',
        'rls_auto_enable'
      )
  loop
    execute format(
      'alter function public.%I(%s) set search_path = public',
      target.proname,
      target.identity_arguments
    );
    execute format(
      'revoke all on function public.%I(%s) from public, anon, authenticated',
      target.proname,
      target.identity_arguments
    );
  end loop;
end;
$$;

-- These helpers are called by authenticated RLS policies and client-side
-- capability checks. They must not be callable by anonymous users.
revoke all on function public.is_team_member(uuid) from public, anon;
revoke all on function public.has_team_capability(uuid, text) from public, anon;
revoke all on function public.is_team_owner(uuid) from public, anon;
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.has_org_role(uuid, text) from public, anon;
revoke all on function public.can_access_team_season(uuid, uuid) from public, anon;

grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.has_team_capability(uuid, text) to authenticated;
grant execute on function public.is_team_owner(uuid) to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text) to authenticated;
grant execute on function public.can_access_team_season(uuid, uuid) to authenticated;

-- Reassert the season/team invariant at the database authorization boundary.
create or replace function public.can_access_team_season(
  target_team_id uuid,
  target_season_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_team_id is not null
    and target_season_id is not null
    and exists (
      select 1
      from public.seasons season
      where season.id = target_season_id
        and season.team_id = target_team_id
        and public.is_team_member(target_team_id)
    );
$$;

revoke all on function public.can_access_team_season(uuid, uuid) from public, anon;
grant execute on function public.can_access_team_season(uuid, uuid) to authenticated;

-- These policies already use the same capability predicates; only their role
-- scope is narrowed from public to authenticated.
alter policy team_schedule_games_update
  on public.team_schedule_games to authenticated;
alter policy team_games_update
  on public.team_games to authenticated;
alter policy team_game_player_stats_update
  on public.team_game_player_stats to authenticated;
alter policy team_game_team_stats_update
  on public.team_game_team_stats to authenticated;
alter policy team_season_records_update
  on public.team_season_records to authenticated;

create index if not exists team_branding_updated_by_idx
  on public.team_branding(updated_by);

create index if not exists team_memberships_invited_by_idx
  on public.team_memberships(invited_by);

create index if not exists team_memberships_role_id_idx
  on public.team_memberships(role_id);

create index if not exists teams_default_season_idx
  on public.teams(default_season_id);
