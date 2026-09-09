# PuckNexus 2.0 — Release Checklist

Run through this before every major release. Do not skip the security section.

## Authentication
- [ ] Signed-out visit to the app root shows Sign In, not a team page
- [ ] Valid sign-in routes to the correct destination
- [ ] Sign out clears the workspace and returns to Sign In without a refresh
- [ ] Expired/invalid session returns to Sign In with a session-expired message
- [ ] Token refresh does not destroy the open workspace

## Platform Admin
- [ ] A platform admin with **zero team memberships** reaches the Admin Dashboard
- [ ] Organizations, teams, users, memberships, and invitations are visible
- [ ] Invitation resend and revoke work and fail closed for non-admins
- [ ] Beta status changes persist and require platform admin
- [ ] A normal coach/team owner/org owner **cannot** open the Admin Dashboard or call `admin_*` RPCs

## Onboarding
- [ ] A brand-new account routes to guided onboarding, not a team page
- [ ] Create Organization → Team → Season each complete once and resume correctly after closing the browser
- [ ] Duplicate org/team/season/player/invite submits are rejected
- [ ] Finish Setup completes once; a second click is a no-op
- [ ] An existing configured user bypasses onboarding entirely

## Coach workflows
- [ ] Add Game creates exactly one game (double-click safe)
- [ ] Edit Game updates the same game ID
- [ ] Delete Game confirms and preserves recorded stats
- [ ] Same-day doubleheader games are allowed with a clear advisory
- [ ] Stat entry saves the whole roster in one action; saving twice does not double totals
- [ ] Goalie shots-against and save % are derived, never entered manually
- [ ] Save states read Save → Saving… → ✓ Saved / Save failed — Retry

## Dashboard
- [ ] Record, GF/GA, differential, and shooting % match the underlying games
- [ ] Leaders rank correctly per category; faceoff % respects the 10-draw minimum
- [ ] Goalie snapshot shows saves, SA, SV%, W/L/T, SO
- [ ] Trends hide arrows when fewer than 6 games exist
- [ ] Switching team or season refreshes every metric with no stale values

## Security
- [ ] Team A coach cannot read or write Team B games, stats, or roster
- [ ] No authorization decision depends on localStorage, URL parameters, or hidden UI
- [ ] RLS is enabled on every 2.0 table (run `tests/migration-chain.test.cjs`)
- [ ] No service-role key or secret is present in browser-shipped code

## Devices
- [ ] Phone (~390px): sign in, onboarding, add game, stat entry, roster — no horizontal overflow
- [ ] Tablet (~768px): dashboard, schedule, admin tables collapse cleanly
- [ ] Desktop: full dashboard and admin views render without overlap

## Data
- [ ] `npm test` passes with zero failures
- [ ] A PostgreSQL 16 validation database applies authoritative migrations 001–019 plus reconciliation migrations 020–022 without error
- [ ] Production migration history reports 001–019 as applied and only reviewed post-019 migrations as pending
- [ ] Existing Arctic Foxes users, roster, games, stats, memberships, branding, storage, and analytics remain intact
