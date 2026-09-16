-- PR36 forward-only private film contract. No platform-admin bypass exists.
insert into public.role_permissions (role_id, capability) values
  ('owner', 'film.view'), ('owner', 'film.edit'), ('assistant_goalie', 'film.view'),
  ('assistant_goalie', 'film.edit'), ('assistant', 'film.view'), ('assistant', 'film.edit')
on conflict do nothing;

create table public.team_film (
  id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id) on delete cascade,
  title text not null, game_date date, opponent text, storage_path text, external_url text,
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  check ((storage_path is null) <> (external_url is null)), check (external_url is null or external_url ~ '^https://')
);
create table public.team_film_clips (
  id uuid primary key default gen_random_uuid(), film_id uuid not null references public.team_film(id) on delete cascade,
  title text not null, notes text, tags text[] not null default '{}', start_seconds numeric not null check (start_seconds >= 0),
  end_seconds numeric not null check (end_seconds > start_seconds), created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.team_film_playlists (
  id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id) on delete cascade,
  title text not null, topic text, sharing text not null default 'team_private' check (sharing in ('team_private', 'selected_staff')),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table public.team_film_playlist_clips (
  playlist_id uuid not null references public.team_film_playlists(id) on delete cascade,
  clip_id uuid not null references public.team_film_clips(id) on delete cascade, position integer not null check (position >= 0),
  primary key (playlist_id, clip_id), unique (playlist_id, position)
);
create table public.team_film_playlist_shares (
  playlist_id uuid not null references public.team_film_playlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now(),
  primary key (playlist_id, user_id)
);
create index team_film_playlist_shares_user_idx on public.team_film_playlist_shares(user_id);

create or replace function public.validate_team_film_playlist_clip()
returns trigger language plpgsql security definer set search_path = public as $$
declare playlist_team_id uuid; clip_team_id uuid;
begin
  select team_id into playlist_team_id from public.team_film_playlists where id = new.playlist_id;
  select f.team_id into clip_team_id from public.team_film_clips c join public.team_film f on f.id = c.film_id where c.id = new.clip_id;
  if playlist_team_id is null then raise exception 'Playlist not found.'; end if;
  if clip_team_id is null then raise exception 'Clip not found.'; end if;
  if playlist_team_id <> clip_team_id then raise exception 'Cannot add clip from a different team to this playlist.'; end if;
  return new;
end; $$;
create trigger team_film_playlist_clips_validate_same_team before insert or update on public.team_film_playlist_clips for each row execute function public.validate_team_film_playlist_clip();

create or replace function public.validate_team_film_playlist_share()
returns trigger language plpgsql security definer set search_path = public as $$
declare playlist_team_id uuid;
begin
  select team_id into playlist_team_id from public.team_film_playlists where id = new.playlist_id;
  if playlist_team_id is null then raise exception 'Playlist not found.'; end if;
  if not exists (select 1 from public.team_memberships m where m.team_id = playlist_team_id and m.user_id = new.user_id and m.status = 'active') then raise exception 'Playlist can only be shared with active members of the same team.'; end if;
  return new;
end; $$;
create trigger team_film_playlist_shares_validate_member before insert or update on public.team_film_playlist_shares for each row execute function public.validate_team_film_playlist_share();

alter table public.team_film enable row level security;
alter table public.team_film_clips enable row level security;
alter table public.team_film_playlists enable row level security;
alter table public.team_film_playlist_clips enable row level security;
alter table public.team_film_playlist_shares enable row level security;
create policy team_film_select_for_members on public.team_film for select to authenticated using (public.has_team_capability(team_id, 'film.view'));
create policy team_film_insert_for_coaches on public.team_film for insert to authenticated with check (public.has_team_capability(team_id, 'film.edit') and created_by = (select auth.uid()));
create policy team_film_update_for_coaches on public.team_film for update to authenticated using (public.has_team_capability(team_id, 'film.edit')) with check (public.has_team_capability(team_id, 'film.edit'));
create policy team_film_delete_for_coaches on public.team_film for delete to authenticated using (public.has_team_capability(team_id, 'film.edit'));
create policy team_film_clips_select_for_members on public.team_film_clips for select to authenticated using (exists (select 1 from public.team_film f where f.id = team_film_clips.film_id and public.has_team_capability(f.team_id, 'film.view')));
create policy team_film_clips_insert_for_coaches on public.team_film_clips for insert to authenticated with check (exists (select 1 from public.team_film f where f.id = team_film_clips.film_id and public.has_team_capability(f.team_id, 'film.edit')) and created_by = (select auth.uid()));
create policy team_film_clips_update_for_coaches on public.team_film_clips for update to authenticated using (exists (select 1 from public.team_film f where f.id = team_film_clips.film_id and public.has_team_capability(f.team_id, 'film.edit'))) with check (exists (select 1 from public.team_film f where f.id = team_film_clips.film_id and public.has_team_capability(f.team_id, 'film.edit')));
create policy team_film_clips_delete_for_coaches on public.team_film_clips for delete to authenticated using (exists (select 1 from public.team_film f where f.id = team_film_clips.film_id and public.has_team_capability(f.team_id, 'film.edit')));
create policy team_film_playlists_select_for_members on public.team_film_playlists for select to authenticated using (public.has_team_capability(team_id, 'film.view') and (sharing = 'team_private' or created_by = (select auth.uid()) or exists (select 1 from public.team_film_playlist_shares s where s.playlist_id = team_film_playlists.id and s.user_id = (select auth.uid()))));
create policy team_film_playlists_insert_for_coaches on public.team_film_playlists for insert to authenticated with check (public.has_team_capability(team_id, 'film.edit') and created_by = (select auth.uid()));
create policy team_film_playlists_update_for_coaches on public.team_film_playlists for update to authenticated using (public.has_team_capability(team_id, 'film.edit') and (created_by = (select auth.uid()) or public.is_team_owner(team_id))) with check (public.has_team_capability(team_id, 'film.edit') and (created_by = (select auth.uid()) or public.is_team_owner(team_id)));
create policy team_film_playlists_delete_for_coaches on public.team_film_playlists for delete to authenticated using (public.has_team_capability(team_id, 'film.edit') and (created_by = (select auth.uid()) or public.is_team_owner(team_id)));
create policy team_film_playlist_clips_select_for_members on public.team_film_playlist_clips for select to authenticated using (exists (select 1 from public.team_film_playlists p where p.id = team_film_playlist_clips.playlist_id and public.has_team_capability(p.team_id, 'film.view') and (p.sharing = 'team_private' or p.created_by = (select auth.uid()) or exists (select 1 from public.team_film_playlist_shares s where s.playlist_id = p.id and s.user_id = (select auth.uid())))));
create policy team_film_playlist_clips_write_for_owners on public.team_film_playlist_clips for all to authenticated using (exists (select 1 from public.team_film_playlists p where p.id = team_film_playlist_clips.playlist_id and public.has_team_capability(p.team_id, 'film.edit') and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id)))) with check (exists (select 1 from public.team_film_playlists p where p.id = team_film_playlist_clips.playlist_id and public.has_team_capability(p.team_id, 'film.edit') and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))));
create policy team_film_playlist_shares_select_for_members on public.team_film_playlist_shares for select to authenticated using (exists (select 1 from public.team_film_playlists p where p.id = team_film_playlist_shares.playlist_id and public.has_team_capability(p.team_id, 'film.view') and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id) or team_film_playlist_shares.user_id = (select auth.uid()))));
create policy team_film_playlist_shares_write_for_owners on public.team_film_playlist_shares for all to authenticated using (exists (select 1 from public.team_film_playlists p where p.id = team_film_playlist_shares.playlist_id and public.has_team_capability(p.team_id, 'film.edit') and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id)))) with check (exists (select 1 from public.team_film_playlists p where p.id = team_film_playlist_shares.playlist_id and public.has_team_capability(p.team_id, 'film.edit') and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))));
revoke all on public.team_film, public.team_film_clips, public.team_film_playlists, public.team_film_playlist_clips, public.team_film_playlist_shares from anon;
grant select, insert, update, delete on public.team_film, public.team_film_clips, public.team_film_playlists, public.team_film_playlist_clips, public.team_film_playlist_shares to authenticated;
revoke all on function public.validate_team_film_playlist_clip(), public.validate_team_film_playlist_share() from public, anon, authenticated;
