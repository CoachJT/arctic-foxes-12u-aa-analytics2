-- Film Web 1.0: link private film records to canonical seasons, games, and media assets.
-- Forward-only queued migration. Do not apply this file outside an approved release.

alter table public.team_film
  add column if not exists season_id uuid references public.seasons(id) on delete set null,
  add column if not exists game_id uuid references public.team_games(id) on delete set null,
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete set null,
  add column if not exists upload_state text not null default 'uploaded'
    check (upload_state in ('pending', 'uploading', 'uploaded', 'failed', 'deleted')),
  add column if not exists duration_seconds numeric check (duration_seconds is null or duration_seconds >= 0),
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  add column if not exists uploaded_at timestamptz;

create index if not exists team_film_team_season_idx on public.team_film(team_id, season_id, created_at desc);
create index if not exists team_film_game_idx on public.team_film(game_id);
create unique index if not exists team_film_media_asset_idx on public.team_film(media_asset_id)
  where media_asset_id is not null;

create or replace function public.validate_team_film_associations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.season_id is not null and not exists (
    select 1 from public.seasons s where s.id = new.season_id and s.team_id = new.team_id
  ) then
    raise exception 'The selected film season does not belong to this team.';
  end if;
  if new.game_id is not null and not exists (
    select 1 from public.team_games g
    where g.id = new.game_id and g.team_id = new.team_id
      and (new.season_id is null or g.season_id = new.season_id)
  ) then
    raise exception 'The selected film game does not belong to this team and season.';
  end if;
  if new.media_asset_id is not null and not exists (
    select 1 from public.media_assets a
    where a.id = new.media_asset_id and a.team_id = new.team_id
      and a.asset_type = 'game_film' and a.bucket_name = 'game-film'
  ) then
    raise exception 'The film media asset is not valid for this team.';
  end if;
  if new.external_url is not null then
    raise exception 'External film URLs are not supported by Film Web 1.0.';
  end if;
  return new;
end; $$;

drop trigger if exists team_film_validate_associations on public.team_film;
create trigger team_film_validate_associations
before insert or update of team_id, season_id, game_id, media_asset_id, external_url
on public.team_film for each row execute function public.validate_team_film_associations();

update public.team_film
set upload_state = case when storage_path is null then 'failed' else 'uploaded' end,
    uploaded_at = case when storage_path is null then null else coalesce(uploaded_at, created_at) end
where upload_state = 'uploaded';

insert into public.role_permissions (role_id, capability)
values ('owner', 'film.share'), ('assistant_goalie', 'film.share'), ('assistant', 'film.share')
on conflict do nothing;

drop policy if exists team_film_update_for_coaches on public.team_film;
create policy team_film_update_for_coaches on public.team_film for update to authenticated
using (public.has_team_capability(team_id, 'film.edit'))
with check (public.has_team_capability(team_id, 'film.edit'));

drop policy if exists team_film_delete_for_coaches on public.team_film;
create policy team_film_delete_for_coaches on public.team_film for delete to authenticated
using (
  public.has_team_capability(team_id, 'film.edit')
  and not exists (select 1 from public.team_film_clips c where c.film_id = team_film.id)
);

drop policy if exists team_film_playlist_shares_write_for_owners on public.team_film_playlist_shares;
create policy team_film_playlist_shares_write_for_owners on public.team_film_playlist_shares
for all to authenticated
using (
  exists (
    select 1 from public.team_film_playlists p
    where p.id = team_film_playlist_shares.playlist_id
      and public.has_team_capability(p.team_id, 'film.share')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
)
with check (
  exists (
    select 1 from public.team_film_playlists p
    where p.id = team_film_playlist_shares.playlist_id
      and public.has_team_capability(p.team_id, 'film.share')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
);

revoke all on function public.validate_team_film_associations() from public, anon, authenticated;
