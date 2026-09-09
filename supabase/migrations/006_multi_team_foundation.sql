-- Multi-team foundation for platform-admin and organization-scoped team access.
-- This migration is additive only: it introduces organizations, team branding,
-- and per-team seasons without deleting or reworking the existing team model.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'coach', 'staff', 'member')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  season_key text not null,
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, season_key)
);

alter table public.teams
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists default_season_id uuid references public.seasons(id) on delete set null;

create table public.team_branding (
  team_id uuid primary key references public.teams(id) on delete cascade,
  display_name text not null default 'Arctic Foxes 12U AA',
  short_name text not null default 'AF',
  logo_url text,
  primary_color text not null default '#d71920',
  secondary_color text not null default '#0d0e10',
  accent_color text not null default '#f2f3f4',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.organizations (id, name, slug, status)
values (
  '11111111-1111-4111-8111-111111111111',
  'Arctic Foxes',
  'arctic-foxes-12u-aa',
  'active'
)
on conflict (slug) do nothing;

insert into public.seasons (team_id, name, season_key, status)
select t.id, '2026-2027 Season', '2026-2027', 'active'
from public.teams t
where t.slug = 'arctic-foxes-12u-aa'
on conflict (team_id, season_key) do update
set name = excluded.name,
    status = excluded.status;

update public.teams t
set organization_id = o.id,
    default_season_id = (
      select s.id
      from public.seasons s
      where s.team_id = t.id
        and s.season_key = '2026-2027'
      order by s.created_at desc
      limit 1
    )
from public.organizations o
where t.slug = 'arctic-foxes-12u-aa'
  and o.slug = 'arctic-foxes-12u-aa';

insert into public.team_branding (team_id, display_name, short_name, primary_color, secondary_color, accent_color, settings)
select t.id,
       'Arctic Foxes 12U AA',
       'AF',
       '#d71920',
       '#0d0e10',
       '#f2f3f4',
       '{}'::jsonb
from public.teams t
where t.slug = 'arctic-foxes-12u-aa'
on conflict (team_id) do update
set display_name = excluded.display_name,
    short_name = excluded.short_name,
    primary_color = excluded.primary_color,
    secondary_color = excluded.secondary_color,
    accent_color = excluded.accent_color,
    settings = excluded.settings;

insert into public.organization_memberships (organization_id, user_id, role, status)
select o.id, p.id, 'owner', 'active'
from public.organizations o
join public.profiles p on p.display_name = 'Justin'
where o.slug = 'arctic-foxes-12u-aa'
on conflict (organization_id, user_id) do update
set role = excluded.role,
    status = excluded.status;
