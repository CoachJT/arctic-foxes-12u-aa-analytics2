-- Minimum database privileges required by the invite-staff Edge Function.
-- RLS remains enabled; these grants do not change authenticated or anon policies.
grant select, insert, update on public.profiles to service_role;
grant select, insert, update on public.team_memberships to service_role;
