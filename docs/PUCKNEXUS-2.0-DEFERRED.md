# PuckNexus 2.0 — Deferred Items Register

Items intentionally not built during Stages 1–8. Each entry lists the blocker
and the recommended next step. None of these block a Release Candidate.

## Platform founder / admin provisioning (operational, required before launch)
The initial Founder + Platform Admin account is **not** hardcoded anywhere.
Provision it once against the production database with the service role:

```sql
-- Run with the service role / as a superuser. Use the real auth user id.
insert into public.platform_admins (user_id, role, granted_by)
values ('<auth-user-id>', 'founder', '<auth-user-id>')
on conflict (user_id) do update set role = 'founder';
```

Grant additional platform admins through the same authoritative table with
`role = 'platform_admin'`. Browser roles cannot mutate platform assignments.

## Organization / team logo upload UI
The production Storage and branding lifecycle exists in migrations `012`–`014`
and `017`, including scoped policies and upload/finalize helpers. A general
logo-management UI outside onboarding remains deferred; it must use those
helpers rather than directly writing arbitrary logo URLs.

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
The onboarding wizard now invokes the team-agnostic `invite-staff` Edge
Function. Production deployment remains deferred. The function must keep
`workspace_invites` authoritative, store only token hashes, and preserve the
delivery controls from migration `018`.

## Full league-wide benchmarks
Dashboard trends compare a team to its **own** season average. League-wide
benchmarks require multi-team aggregate data that does not exist yet.
