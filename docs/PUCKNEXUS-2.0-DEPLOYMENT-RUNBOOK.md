# PuckNexus 2.0 — Production Deployment Runbook

Release commit: see the release PR (branch `coachjt-fix-analytics-task`).
Pre-deployment verification: `docs/PUCKNEXUS-2.0-RELEASE-CHECKLIST.md`.

> STOP conditions: if any step errors, shows a migration-history mismatch, or
> threatens existing data, stop and report — do not force past it.

---

## 0. Merge the release PR

Merge the release PR into `main`. Record the merge commit SHA — that is the
production release commit.

---

## 1. Confirm the production Supabase project

The web app is configured for project ref `yshbvrumzusmwlprfcnr`.
Confirm this is the intended **production** project before proceeding.

```bash
supabase login            # opens browser auth
supabase link --project-ref yshbvrumzusmwlprfcnr
```

## 2. Audit existing migration state (read-only)

Do NOT run `db reset`. See what production already has:

```bash
supabase migration list
```

Expected already-applied: `001`, `002`, `003` (and any pre-2.0 migrations).
Expected to apply now: `006`, `007`, `008`, `009`, `010`.

If `migration list` shows a migration number colliding with a different
filename than the one in this repo, STOP — that is a history mismatch.

## 3. Confirm Arctic Foxes data will be preserved

All of 006–010 are **additive** (new tables/columns; `on conflict` backfills).
No `drop`, no `delete from`, no `truncate`. The only data writes are the
Arctic Foxes organization/season/branding backfill keyed to slug
`arctic-foxes-12u-aa` and season `2026-2027`, which are upserts.

Before applying, snapshot for safety (optional but recommended):

```bash
supabase db dump --data-only -f pre-2.0-backup.sql
```

## 4. Apply only the missing migrations

```bash
supabase migration up
```

This applies pending migrations in order and skips already-applied ones.
If it tries to re-run 001/002/003, STOP and report.

## 5. Deploy the generalized invite-staff Edge Function

The function is now team-agnostic (derives team from the validated request,
no Arctic Foxes hardcoding):

```bash
supabase functions deploy invite-staff
```

Confirm required env vars are set on the project: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally
`INVITE_REDIRECT_URL`.

## 6. Deploy the web app to app.pucknexus.com

Deploy the contents of `web/` to your static host. The entry point is
`web/index.html`. All assets are versioned with `?v=` strings; no service
worker exists, so a normal static deploy with standard cache headers is
sufficient. No build step is required.

## 7. Provision the Founder + Platform Admin account

Do NOT hardcode this into app code. First create the founder's auth account
(sign up through the app or the Supabase dashboard), note its `auth.users.id`,
then grant the roles with the service role (SQL Editor or `db execute`):

```sql
-- Replace <auth-user-id> with the founder's real auth.users id.
insert into public.platform_roles (user_id, role, status)
values ('<auth-user-id>', 'founder', 'active')
on conflict (user_id, role) do nothing;
```

The founder can then grant `platform_admin` to others via the same table
(`role = 'platform_admin'`). Only a founder can grant/revoke `founder`
(enforced by RLS in migration 007).

## 8. Post-deployment smoke tests

- Signed-out visit to https://app.pucknexus.com shows Sign In
- Founder sign-in lands on Admin Dashboard (no team membership needed)
- Arctic Foxes coach sign-in lands on its Team Dashboard with existing data intact
- Add Game creates exactly one game (double-click safe)
- Edit Game updates the same game
- Roster add/edit/remove works; duplicate jersey rejected
- Stat entry saves; saving twice does not double totals; dashboard reflects it
- Invitations send and appear in the admin Invitations view
- A normal coach cannot open the Admin Dashboard or another team's data
- Sign out → sign in preserves all cloud data
- Onboarding works for a safe test account and completes once

## Rollback

If a post-deploy smoke test fails on data integrity or access control, stop.
Migrations 006–010 are additive, so the pre-2.0 app continues to work against
the upgraded schema; to fully roll back, redeploy the previous web build.
Do not drop the new tables unless you have confirmed they hold no new data.
