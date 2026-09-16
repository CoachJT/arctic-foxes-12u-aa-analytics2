# PuckNexus visual overhaul: backend audit and review

Starting main: 18c35f3e4433c1fb644f00515dded7baf22b3944 (PR #40 login-reference-design).
Local branch: feature/visual-overhaul-20260916.
Audit performed September 16, 2026 UTC. No deployment, push, merge, migration, Edge Function, RLS, project configuration, or production-data mutation was performed.

## Read-only capability audit

Inspected repository migrations, current web integration, and metadata from project yshbvrumzusmwlprfcnr. SQL queries read information_schema.columns, pg_policies, pg_proc definitions/signatures and the organization-branding bucket configuration; they did not query customer roster or account data.

- team_branding exists with team_id, display_name, short_name, logo_url, primary_color, secondary_color, accent_color, settings (jsonb), updated_by, updated_at.
- SELECT uses is_team_member(team_id). INSERT/UPDATE require is_team_owner(team_id); UPDATE has both USING and WITH CHECK. Current is_team_owner resolves has_team_capability(target_team_id, 'admin.permissions').
- organization-branding is an existing public bucket with a 10 MB limit and PNG/JPEG/WebP allowlist.
- prepare_organization_branding_asset, finalize_organization_branding_asset and abort_organization_branding_asset exist. Their existing flow prepares a server-generated object path, uploads without overwrite, and finalizes the team pointer. Server-side URL generation has a configured HTTPS project URL.
- Supported upload keys include logo, wordmark, secondary and hero. Existing pointers are logo_url, settings.wordmark_url, settings.secondary_image_url and settings.hero_image_url.
- Existing onboarding_ensure, organization/team/season creation, roster, staff-list, branding, onboarding2_ensure/mark_step/complete and first-game functions are present. Existing invitation flow continues to use invite-staff. No function was executed to create or change a user/team during testing.

## Implemented using existing backend

Team Settings reads its selected team's branding row. Active members with the database-provided admin.permissions capability can save team display name, colors, tagline/bio, per-page themes, background visibility and browser favicon preference. The editor does not infer team authority from Platform Admin/Founder identity. Database RLS remains authoritative.

New appearance preferences use settings.visual = {tagline,bio,page_themes,backgrounds,use_logo_icon}; this is ordinary JSON content in the already-existing settings column, not a schema addition. Unknown settings, feature image references and uploaded artwork pointers are preserved. Writes filter by team_id and original updated_at; a zero-row update is treated as conflict/access denial, never success. A missing branding row is reported instead of silently created.

Image uploads use the existing prepare/upload/finalize/abort pipeline. Uploads publish separately from the form save, and the UI says so. The primary logo appears in team identity, the wordmark in the sidebar, secondary artwork in the footer, and custom hero artwork can be selected per page. The primary logo can also serve as the active team's browser favicon. It is cleared on team/account reset.

Nine built-in choices cover Command Center, Schedule, Game Center, Roster & Players, Team Pulse (the existing Team Stats route), Film, Scouting, Reports, Development, Staff and Settings. Ice Arena reuses the existing rink photograph; the other choices use original compact SVG illustrations. Backgrounds are decorative, darkened and switchable. No extra navigation routes or fabricated product data were added. Reports/Development retain their existing unsynced states.

The exact official logo attachment from the Brand Reference Confirmation task is stored unchanged at web/assets/pucknexus-official.png. CSS frames its empty margins; no generated replacement was used. Existing cinematic login, Sign In/Sign Up, password reset, beta-testers recognition and onboarding are retained. Dead marketing navigation and a disabled Remember me checkbox were removed; mobile controls and auth accessibility were improved. Legitimate existing sessions retain their existing behavior; signed-out users are not given a sample identity. The repository's explicit localhost-only prototype mode remains unchanged.

## Frontend-only or separate dependencies

- Desktop/tablet/mobile branding previews use clearly marked example content. Unsaved preview values are not written to localStorage or presented as persisted.
- Installed PWA/OS app icon customization is unsupported. A dedicated favicon/icon upload asset key and installable app manifest/service-worker lifecycle would need separate design/backend approval. Current support is browser favicon reuse of the primary logo only.
- Managers without admin.permissions cannot save. Extending their authority requires separately approved capability/RLS changes; this branch does not broaden permissions.
- Auth signup enablement, email delivery, redirect allowlists and Google provider configuration were not modified or exercised with real accounts. Signup/email verification depend on existing Auth configuration.
- Staff invitations retain the existing invite-staff dependency. The previously reported invitation/Edge Function issue is not represented as fixed.
- Existing onboarding can require a first game before completion. Relaxing that server-enforced requirement is a separate change; this branch preserves it.
- Actual account creation, cross-device persistence, image uploads and tenant enforcement against production were deliberately not tested with writes. Client behavior is tested locally against stubs and backend support was verified read-only. No production acceptance claim is made.

## Validation

Baseline: 391/391 tests passed. Final: 401/401 tests passed, no skips.
New tests cover role separation, image URL validation, color validation/contrast, preservation of unrelated settings, theme asset existence, team/revision-scoped updates, zero-row conflict/denial, successful/error save responses, upload abort behavior, finalization and invalid file/type/key rejection.
Two existing tests were updated solely to expect the new app.js cache version.
All web JavaScript files pass node --check. git diff --check passes.
The web deployment copies web/ directly; there is no web compilation/build script. Static asset validation is used as the web build check. Desktop Electron packaging is unrelated to this web-only change and was not run.

Browser review used a loopback-only server with the real web UI and an in-memory client fixture. The served authentication page replaced the Supabase SDK with a stub. No browser action could create an account, send reset mail, upload artwork or edit production team data. Reviewed phone (390px), tablet (768px) and desktop (1440px) layouts; no horizontal overflow was observed on the reviewed authentication/editor screens. Confirmed signup navigation, read-only disabled save, preview changes, local save feedback and the integrated Command Center. Example team/game data appears only in the temporary fixture, never in shipped source.

API references checked: https://supabase.com/docs/reference/javascript/update and repository-pinned integration patterns. Supabase changelog Markdown and upload-doc fetching were attempted but unavailable in the web reader; no new Supabase SDK/API was introduced.
