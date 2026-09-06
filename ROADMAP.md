# Roadmap

## Phase 0 — local prototype (complete)

- Establish a cloud/team-facing information architecture without changing the Windows app.
- Build responsive Command Center, Schedule, Team Stats, Player Profiles, Game Center, Scouting, Coach Reports, Admin, and Settings surfaces.
- Separate sample data from future live team data.
- Document the target architecture and access model.

## Phase 1 — contracts and foundation

- Define shared TypeScript domain models for teams, players, games, shifts, analytics, scouting, and reports.
- Choose a cloud backend and relational data model.
- Define API versioning, sync status, conflict handling, and audit requirements.
- Define backend authorization around stable capability keys, staff membership, invitations, and role changes.
- Define an append-only audit event contract covering permission changes, official stat edits, destructive actions, backups, and releases.
- Add environment-aware web development and deployment.

## Phase 2 — Windows bridge

- Export a stable analytics package from the Windows app.
- Upload derived results and metadata through authenticated API endpoints.
- Keep full-game video processing local to Windows; do not upload raw video by default.
- Add retryable sync, idempotency, and visible sync status.

## Phase 3 — team collaboration

- Add real authentication, invitations, roles, and permissions.
- Enforce server-side authorization and persist audit events; treat all client-side guards as UX only.
- Sync schedule, roster, game results, shifts, scouting, reports, and player profiles.
- Add coach report sharing and an approval/publish state.
- Add player/parent access only after the coach-facing model is stable.

## Phase 4 — mobile and operations

- Installable responsive web experience / PWA.
- Offline-friendly schedule and game-day views.
- Notifications, backups, data export, retention controls, and observability.
