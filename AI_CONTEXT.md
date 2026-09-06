# AI Context

## Product boundary

This repository contains two intentionally separate surfaces:

1. **Windows Analytics App** — the existing Electron application at the repository root. It owns local video processing and current desktop workflows.
2. **Web prototype** — the static prototype in `web/`. It demonstrates the future cloud/team-facing information architecture and responsive UX.

Do not replace, rewrite, or couple the Windows app to the prototype while the backend contract is undefined.

## Recommended web stack

The current prototype deliberately uses semantic HTML, CSS, and vanilla JavaScript so it can be opened immediately with no new dependency or build step. For production web development, migrate `web/` to **Vite + React + TypeScript**:

- Vite keeps local development and deployment fast.
- React supports the many workspace views and shared responsive components.
- TypeScript gives the Windows app, API, and client a safer shared data contract.
- TanStack Query is a good later addition for server state and sync status.
- Use a backend-agnostic HTTP client layer so authentication and provider choices remain replaceable.

## Data rules

- Prototype values are illustrative sample data only.
- Never represent sample player statistics as authoritative team records.
- Keep raw full-game video on Windows initially.
- Prefer synced derived data: analytics results, stats, shifts, scouting, reports, schedules, and player information.
- Real identity, roles, permissions, audit logs, and invitations belong to the backend phase.

## Design language

The web prototype uses a dark navy/ice-blue Arctic Foxes identity, red only for loss/attention states, compact data density, and responsive navigation. Preserve touch-friendly controls and readable tables for iPad and iPhone.
