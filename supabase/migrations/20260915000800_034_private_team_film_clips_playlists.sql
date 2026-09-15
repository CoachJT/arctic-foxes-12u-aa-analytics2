-- Reconciled Forward Migration 034: Private Team Film, Clips, and Playlists.
-- Enforces same-team playlist clips, selected-staff sharing limited to active
-- same-team staff, and private team-scoped RLS policies with no platform admin bypass.

insert into public.role_permissions (role_id, capability) values
  ('owner', 'film.view'),
  ('owner', 'film.edit'),
  ('assistant_goalie', 'film.view'),
  ('assistant_goalie', 'film.edit'),
  ('assistant', 'film.view'),
  ('assistant', 'film.edit')
on conflict do nothing;

create table if not exists public.team_film_playlist_shares (
  playlist_id uuid not null references public.team_film_playlists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (playlist_id, user_id)
);

create index if not exists team_film_playlist_shares_user_idx
  on public.team_film_playlist_shares(user_id);

create or replace function public.validate_team_film_playlist_clip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  playlist_team_id uuid;
  clip_team_id uuid;
begin
  select p.team_id into playlist_team_id
  from public.team_film_playlists p
  where p.id = new.playlist_id;

  select f.team_id into clip_team_id
  from public.team_film_clips c
  join public.team_film f on f.id = c.film_id
  where c.id = new.clip_id;

  if playlist_team_id is null then
    raise exception 'Playlist not found.';
  end if;

  if clip_team_id is null then
    raise exception 'Clip not found.';
  end if;

  if playlist_team_id <> clip_team_id then
    raise exception 'Cannot add clip from a different team to this playlist.';
  end if;

  return new;
end;
$$;

drop trigger if exists team_film_playlist_clips_validate_same_team on public.team_film_playlist_clips;
create trigger team_film_playlist_clips_validate_same_team
before insert or update on public.team_film_playlist_clips
for each row execute function public.validate_team_film_playlist_clip();

create or replace function public.validate_team_film_playlist_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  playlist_team_id uuid;
begin
  select p.team_id into playlist_team_id
  from public.team_film_playlists p
  where p.id = new.playlist_id;

  if playlist_team_id is null then
    raise exception 'Playlist not found.';
  end if;

  if not exists (
    select 1
    from public.team_memberships m
    where m.team_id = playlist_team_id
      and m.user_id = new.user_id
      and m.status = 'active'
  ) then
    raise exception 'Playlist can only be shared with active members of the same team.';
  end if;

  return new;
end;
$$;

drop trigger if exists team_film_playlist_shares_validate_member on public.team_film_playlist_shares;
create trigger team_film_playlist_shares_validate_member
before insert or update on public.team_film_playlist_shares
for each row execute function public.validate_team_film_playlist_share();

alter table public.team_film enable row level security;
alter table public.team_film_clips enable row level security;
alter table public.team_film_playlists enable row level security;
alter table public.team_film_playlist_clips enable row level security;
alter table public.team_film_playlist_shares enable row level security;

drop policy if exists team_film_select_for_members on public.team_film;
create policy team_film_select_for_members
on public.team_film for select
to authenticated
using (public.has_team_capability(team_id, 'film.view'));

drop policy if exists team_film_insert_for_coaches on public.team_film;
create policy team_film_insert_for_coaches
on public.team_film for insert
to authenticated
with check (
  public.has_team_capability(team_id, 'film.edit')
  and created_by = (select auth.uid())
);

drop policy if exists team_film_update_for_coaches on public.team_film;
create policy team_film_update_for_coaches
on public.team_film for update
to authenticated
using (public.has_team_capability(team_id, 'film.edit'))
with check (public.has_team_capability(team_id, 'film.edit'));

drop policy if exists team_film_delete_for_coaches on public.team_film;
create policy team_film_delete_for_coaches
on public.team_film for delete
to authenticated
using (public.has_team_capability(team_id, 'film.edit'));

drop policy if exists team_film_clips_select_for_members on public.team_film_clips;
create policy team_film_clips_select_for_members
on public.team_film_clips for select
to authenticated
using (
  exists (
    select 1
    from public.team_film f
    where f.id = team_film_clips.film_id
      and public.has_team_capability(f.team_id, 'film.view')
  )
);

drop policy if exists team_film_clips_insert_for_coaches on public.team_film_clips;
create policy team_film_clips_insert_for_coaches
on public.team_film_clips for insert
to authenticated
with check (
  exists (
    select 1
    from public.team_film f
    where f.id = team_film_clips.film_id
      and public.has_team_capability(f.team_id, 'film.edit')
  )
  and created_by = (select auth.uid())
);

drop policy if exists team_film_clips_update_for_coaches on public.team_film_clips;
create policy team_film_clips_update_for_coaches
on public.team_film_clips for update
to authenticated
using (
  exists (
    select 1
    from public.team_film f
    where f.id = team_film_clips.film_id
      and public.has_team_capability(f.team_id, 'film.edit')
  )
)
with check (
  exists (
    select 1
    from public.team_film f
    where f.id = team_film_clips.film_id
      and public.has_team_capability(f.team_id, 'film.edit')
  )
);

drop policy if exists team_film_clips_delete_for_coaches on public.team_film_clips;
create policy team_film_clips_delete_for_coaches
on public.team_film_clips for delete
to authenticated
using (
  exists (
    select 1
    from public.team_film f
    where f.id = team_film_clips.film_id
      and public.has_team_capability(f.team_id, 'film.edit')
  )
);

drop policy if exists team_film_playlists_select_for_members on public.team_film_playlists;
create policy team_film_playlists_select_for_members
on public.team_film_playlists for select
to authenticated
using (
  public.has_team_capability(team_id, 'film.view')
  and (
    sharing = 'team_private'
    or created_by = (select auth.uid())
    or exists (
      select 1
      from public.team_film_playlist_shares s
      where s.playlist_id = team_film_playlists.id
        and s.user_id = (select auth.uid())
    )
  )
);

drop policy if exists team_film_playlists_insert_for_coaches on public.team_film_playlists;
create policy team_film_playlists_insert_for_coaches
on public.team_film_playlists for insert
to authenticated
with check (
  public.has_team_capability(team_id, 'film.edit')
  and created_by = (select auth.uid())
);

drop policy if exists team_film_playlists_update_for_coaches on public.team_film_playlists;
create policy team_film_playlists_update_for_coaches
on public.team_film_playlists for update
to authenticated
using (
  public.has_team_capability(team_id, 'film.edit')
  and (created_by = (select auth.uid()) or public.is_team_owner(team_id))
)
with check (
  public.has_team_capability(team_id, 'film.edit')
  and (created_by = (select auth.uid()) or public.is_team_owner(team_id))
);

drop policy if exists team_film_playlists_delete_for_coaches on public.team_film_playlists;
create policy team_film_playlists_delete_for_coaches
on public.team_film_playlists for delete
to authenticated
using (
  public.has_team_capability(team_id, 'film.edit')
  and (created_by = (select auth.uid()) or public.is_team_owner(team_id))
);

drop policy if exists team_film_playlist_clips_select_for_members on public.team_film_playlist_clips;
create policy team_film_playlist_clips_select_for_members
on public.team_film_playlist_clips for select
to authenticated
using (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_clips.playlist_id
      and public.has_team_capability(p.team_id, 'film.view')
      and (
        p.sharing = 'team_private'
        or p.created_by = (select auth.uid())
        or exists (
          select 1
          from public.team_film_playlist_shares s
          where s.playlist_id = p.id
            and s.user_id = (select auth.uid())
        )
      )
  )
);

drop policy if exists team_film_playlist_clips_insert_for_coaches on public.team_film_playlist_clips;
create policy team_film_playlist_clips_insert_for_coaches
on public.team_film_playlist_clips for insert
to authenticated
with check (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_clips.playlist_id
      and public.has_team_capability(p.team_id, 'film.edit')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
);

drop policy if exists team_film_playlist_clips_update_for_coaches on public.team_film_playlist_clips;
create policy team_film_playlist_clips_update_for_coaches
on public.team_film_playlist_clips for update
to authenticated
using (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_clips.playlist_id
      and public.has_team_capability(p.team_id, 'film.edit')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
)
with check (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_clips.playlist_id
      and public.has_team_capability(p.team_id, 'film.edit')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
);

drop policy if exists team_film_playlist_clips_delete_for_coaches on public.team_film_playlist_clips;
create policy team_film_playlist_clips_delete_for_coaches
on public.team_film_playlist_clips for delete
to authenticated
using (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_clips.playlist_id
      and public.has_team_capability(p.team_id, 'film.edit')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
);

drop policy if exists team_film_playlist_shares_select_for_members on public.team_film_playlist_shares;
create policy team_film_playlist_shares_select_for_members
on public.team_film_playlist_shares for select
to authenticated
using (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_shares.playlist_id
      and public.has_team_capability(p.team_id, 'film.view')
      and (
        p.created_by = (select auth.uid())
        or public.is_team_owner(p.team_id)
        or team_film_playlist_shares.user_id = (select auth.uid())
      )
  )
);

drop policy if exists team_film_playlist_shares_insert_for_coaches on public.team_film_playlist_shares;
create policy team_film_playlist_shares_insert_for_coaches
on public.team_film_playlist_shares for insert
to authenticated
with check (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_shares.playlist_id
      and public.has_team_capability(p.team_id, 'film.edit')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
);

drop policy if exists team_film_playlist_shares_delete_for_coaches on public.team_film_playlist_shares;
create policy team_film_playlist_shares_delete_for_coaches
on public.team_film_playlist_shares for delete
to authenticated
using (
  exists (
    select 1
    from public.team_film_playlists p
    where p.id = team_film_playlist_shares.playlist_id
      and public.has_team_capability(p.team_id, 'film.edit')
      and (p.created_by = (select auth.uid()) or public.is_team_owner(p.team_id))
  )
);

revoke all on public.team_film,
  public.team_film_clips,
  public.team_film_playlists,
  public.team_film_playlist_clips,
  public.team_film_playlist_shares
from anon;

grant select, insert, update, delete on public.team_film to authenticated;
grant select, insert, update, delete on public.team_film_clips to authenticated;
grant select, insert, update, delete on public.team_film_playlists to authenticated;
grant select, insert, update, delete on public.team_film_playlist_clips to authenticated;
grant select, insert, delete on public.team_film_playlist_shares to authenticated;

revoke all on function public.validate_team_film_playlist_clip() from public, anon, authenticated;
revoke all on function public.validate_team_film_playlist_share() from public, anon, authenticated;
