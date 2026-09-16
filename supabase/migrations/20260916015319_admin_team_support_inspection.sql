-- Proposed additive support access. Does not alter existing team policies or records.
create schema if not exists pnx_support_private;
revoke all on schema pnx_support_private from public, anon;
grant usage on schema pnx_support_private to authenticated;
create table pnx_support_private.access_log (
 id bigint generated always as identity primary key,
 admin_user_id uuid not null,
 team_id uuid not null,
 season_id uuid,
 opened_at timestamptz not null default now()
);
alter table pnx_support_private.access_log enable row level security;
revoke all on pnx_support_private.access_log from public,anon,authenticated;
create function pnx_support_private.team_snapshot(target_team_id uuid, target_season_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare chosen_season uuid; result jsonb;
begin
 if auth.uid() is null or not public.is_platform_admin() then raise exception 'Platform Admin access required.' using errcode='42501'; end if;
 if not exists(select 1 from public.teams where id=target_team_id) then raise exception 'Team not found.'; end if;
 select coalesce(target_season_id,t.default_season_id) into chosen_season from public.teams t where t.id=target_team_id;
 if chosen_season is not null and not exists(select 1 from public.seasons where id=chosen_season and team_id=target_team_id) then raise exception 'Season does not belong to this team.'; end if;
 insert into pnx_support_private.access_log(admin_user_id,team_id,season_id) values(auth.uid(),target_team_id,chosen_season);
 select jsonb_build_object(
  'team_id',target_team_id,'season_id',chosen_season,'checked_at',now(),'today',current_date,
  'seasons',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'status',s.status) order by s.created_at desc) from public.seasons s where s.team_id=target_team_id),'[]'::jsonb),
  'roster_count',(select count(*) from public.team_roster_players p where p.team_id=target_team_id and p.status='active'),
  'game_count',(select count(*) from public.team_games g where g.team_id=target_team_id and g.season_id=chosen_season),
  'roster',coalesce((select jsonb_agg(to_jsonb(p)) from (select r.source_player_id,r.name,r.jersey_number,r.position,r.player_type from public.team_roster_players r where r.team_id=target_team_id and r.status='active' order by r.position,r.jersey_number limit 500) p),'[]'::jsonb),
  'games',coalesce((select jsonb_agg(to_jsonb(g)) from (select g.source_game_id,g.date,g.opponent,g.updated_at,s.goals_for,s.goals_against,s.shots_for,s.shots_against,
    (select count(*) from public.team_game_player_stats p where p.team_id=target_team_id and p.season_id=chosen_season and p.source_game_id=g.source_game_id) as player_stat_rows,
    (select sum(p.goals) from public.team_game_player_stats p where p.team_id=target_team_id and p.season_id=chosen_season and p.source_game_id=g.source_game_id and p.player_type='skater') as player_goals
   from public.team_games g left join public.team_game_team_stats s on s.team_id=g.team_id and s.season_id=g.season_id and s.source_game_id=g.source_game_id
   where g.team_id=target_team_id and g.season_id=chosen_season order by g.date desc,g.source_game_id limit 200) g),'[]'::jsonb),
  'reports',coalesce((select jsonb_agg(to_jsonb(r)) from (select subject,description,status,priority,page_route,created_at from public.support_reports where team_id=target_team_id order by created_at desc limit 50) r),'[]'::jsonb)
 ) into result;
 return result;
end; $$;
revoke all on function pnx_support_private.team_snapshot(uuid,uuid) from public,anon;
grant execute on function pnx_support_private.team_snapshot(uuid,uuid) to authenticated;
create function public.admin_team_support_snapshot(target_team_id uuid,target_season_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$ select pnx_support_private.team_snapshot(target_team_id,target_season_id); $$;
revoke all on function public.admin_team_support_snapshot(uuid,uuid) from public,anon;
grant execute on function public.admin_team_support_snapshot(uuid,uuid) to authenticated;
