# PuckNexus 2.0 — Deferred Items Register

Items intentionally not built during Stages 1–8. Each entry lists the blocker
and the recommended next step. None of these block a Release Candidate.

## Platform founder / admin provisioning (operational, required before launch)
The initial Founder + Platform Admin account is **not** hardcoded anywhere.
Provision it once against the production database with the service role:

```sql
-- Run with the service role / as a superuser. Use the real auth user id.
insert into public.platform_roles (user_id, role, status)
values ('<auth-user-id>', 'founder', 'active')
on conflict (user_id, role) do nothing;
```

Grant additional platform admins as the founder through the same table with
`role = 'platform_admin'`. Only a founder can grant or remove `founder`
(enforced by RLS in migration 007).

## Organization / team logo upload
Deferred. Requires Supabase Storage infrastructure (bucket, RLS-scoped upload
policies, file-type and size validation, preview). Not present in the current
schema. Next step: create a private `branding-logos` bucket with
team/org-scoped policies before adding UI.

## Admin "Reset Onboarding"
Deferred. The `onboarding_progress` model supports it (platform admins can
delete/reset a row), but no UI control exists yet. Never delete org/team/roster
data to reset progress — only the progress row.

## Windows / Electron cloud synchronization
Deferred by design. The website is the primary product and Supabase is
authoritative. Future Electron work must **consume** web-authored core records
(organizations, teams, seasons, rosters, games, stats) from Supabase and
contribute specialized data (film, clips, tracking, advanced analysis) without
overwriting authoritative web records. Note: web-authored roster rows use
`web-`-prefixed `source_player_id` values so a future sync mapper can treat
them as authoritative and avoid conflicts with Windows-originated rows.

## Invite email delivery from the onboarding wizard
The `invite-staff` Edge Function is now team-agnostic (no hardcoded team) and
derives scope from the caller's request validated against ownership. Onboarding
creates the first-class `team_invitations` record; wiring the wizard to trigger
the actual email send through the function is the remaining step. Requires a
function deployment to take effect (not deployed in Stage 8).

## Full league-wide benchmarks
Dashboard trends compare a team to its **own** season average. League-wide
benchmarks require multi-team aggregate data that does not exist yet.
