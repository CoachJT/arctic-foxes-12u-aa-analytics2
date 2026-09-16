-- Film Web 1.0 release-blocking fix: avoid recursive RLS evaluation between
-- playlists and selected-staff share rows. Apply only after migration 032.

create or replace function public.can_read_team_film_playlist(target_playlist_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_film_playlists playlist
    where playlist.id = target_playlist_id
      and public.has_team_capability(playlist.team_id, 'film.view')
      and (
        playlist.sharing = 'team_private'
        or playlist.created_by = (select auth.uid())
        or exists (
          select 1
          from public.team_film_playlist_shares share_row
          where share_row.playlist_id = playlist.id
            and share_row.user_id = (select auth.uid())
        )
      )
  );
$$;

revoke all on function public.can_read_team_film_playlist(uuid) from public, anon;
grant execute on function public.can_read_team_film_playlist(uuid) to authenticated;

drop policy if exists team_film_playlists_select_for_members on public.team_film_playlists;
create policy team_film_playlists_select_for_members
on public.team_film_playlists
for select to authenticated
using (public.can_read_team_film_playlist(id));

drop policy if exists team_film_playlist_clips_select_for_members on public.team_film_playlist_clips;
create policy team_film_playlist_clips_select_for_members
on public.team_film_playlist_clips
for select to authenticated
using (public.can_read_team_film_playlist(playlist_id));
