# PuckNexus 2.0 — Production Deployment Runbook

Release commit: use the reviewed reconciliation release commit.
Pre-deployment verification: `docs/PUCKNEXUS-2.0-RELEASE-CHECKLIST.md`.

> STOP conditions: if any step errors, shows a migration-history mismatch, or
> threatens existing data, stop and report — do not force past it.

---

## 0. Merge the release PR

Merge the release PR into `main`. Record the merge commit SHA — that is the
production release commit.

---

## 1. Confirm the production Supabase project

The verified production project is **CoachJT's Project**, ref
`yshbvrumzusmwlprfcnr`. Confirm the authenticated CLI account still resolves
that exact project before proceeding.

```bash
supabase login            # opens browser auth
supabase link --project-ref yshbvrumzusmwlprfcnr
```

## 2. Audit existing migration state (read-only)

Do NOT run `db reset`. See what production already has:

```bash
supabase migration list
```

Expected already-applied: the authoritative production lineage `001`, `002`,
`003`, `006`–`015`, and timestamped `016`–`019`.
Expected to apply for this reconciliation release only:

- `20260909000100_020_reconciled_platform_admin_dashboard.sql`
- `20260909000200_021_reconciled_self_service_onboarding.sql`
- `20260909000300_022_reconciled_workspace_invite_delivery.sql`

If `migration list` shows a migration number colliding with a different
filename than the one in this repo, STOP — that is a history mismatch.

## 3. Confirm Arctic Foxes data will be preserved

Migrations `006`–`019` are immutable production history and must not be
reapplied or repaired. Migrations `020`–`022` are forward-only: they add the
Admin Dashboard compatibility layer, Founder specialization on
`platform_admins`, and locked self-service onboarding. They do not replace
production roster, invitation, stat, storage, or analytics tables.

Before applying, snapshot for safety (optional but recommended):

```bash
supabase db dump --data-only -f pre-2.0-backup.sql
```

## 4. Apply only the missing migrations

```bash
supabase migration up
```

This applies pending migrations in order and skips already-applied ones.
If it tries to re-run any migration through `019`, STOP and report.

## 5. Deploy the generalized invite-staff Edge Function

The function is team-agnostic and preserves the production
`workspace_invites` lifecycle. It generates raw tokens only server-side,
stores hashes, and uses the delivery controls added in migration `018`:

```bash
supabase functions deploy invite-staff
```

Confirm required env vars are set on the project: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`INVITE_REDIRECT_URL`. The redirect must be an HTTPS URL for the production
web app; invitation delivery fails closed if it is absent or invalid.

## 6. Deploy the web app to app.pucknexus.com

Deploy the contents of `web/` to your static host. The entry point is
`web/index.html`. All assets are versioned with `?v=` strings; no service
worker exists, so a normal static deploy with standard cache headers is
sufficient. No build step is required.

## 7. Provision the Founder + Platform Admin account

Do NOT hardcode this into app code. First create the founder's auth account
(sign up through the app or the Supabase dashboard), note its `auth.users.id`,
then grant the role with the service role (SQL Editor or another audited
server-side administrative path):

```sql
-- Replace <auth-user-id> with the founder's real auth.users id.
insert into public.platform_admins (user_id, role, granted_by)
values ('<auth-user-id>', 'founder', '<auth-user-id>')
on conflict (user_id) do update
set role = 'founder';
```

Additional platform administrators use the same authoritative table with
`role = 'platform_admin'`. Browser roles have no insert, update, or delete
privileges on this table.

## 8. Post-deployment smoke tests

- Signed-out visit to https://app.pucknexus.com shows Sign In
- Founder sign-in lands on Admin Dashboard (no team membership needed)
- Arctic Foxes coach sign-in lands on its Team Dashboard with existing data intact
- Add Game creates exactly one game (double-click safe)
- Edit Game updates the same game
- Roster add/edit/deactivate works; duplicate active jersey rejected
- Stat entry saves; saving twice does not double totals; dashboard reflects it
- Invitations send and appear in the admin Invitations view
- A normal coach cannot open the Admin Dashboard or another team's data
- Sign out → sign in preserves all cloud data
- Onboarding works for a safe test account and completes once

## Rollback

If a post-deploy smoke test fails on data integrity or access control, stop.
The reconciliation migrations are additive, so rollback is a previous web and
Edge Function deploy. Do not rewrite migration history or drop reconciliation
objects after they contain production data.
