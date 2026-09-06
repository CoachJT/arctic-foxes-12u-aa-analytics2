# Arctic Foxes 12U AA Analytics — AI Context

## Project identity

This is the Arctic Foxes 12U AA analytics application: a Windows-first Electron desktop platform for hockey game tracking, film review, scouting, player development, statistics, and coaching decisions. The current reviewed release is **v4.2.0**.

This document is the persistent handoff for coding agents. Read it before changing code, then read `ROADMAP.md`, `NEXT_TASKS.md`, and the latest applicable `RELEASE_*.md` file.

## Architecture

- `main.js` is the Electron main process. It creates the window, owns IPC handlers, manages season-data paths and backups, selects local video files, and integrates `electron-updater`.
- `preload.js` exposes the deliberately limited renderer API through `contextBridge`.
- `index.html` is the primary renderer and contains the application shell plus workspace mounts and legacy UI surfaces.
- `scouting.html` is the separate private scouting window.
- Core logic is split into browser/CommonJS-compatible modules:
  - `analytics.js`, `ice-time.js`, and `interface-model.js` provide normalization, ratings, time calculations, and dashboard models.
  - `toi-engine.js`, `toi-ui.js`, `crossing-detector.js`, and `scoreboard-clock.js` provide film time-on-ice and stoppage-review behavior.
  - `film-workspace.js`, `film-breaks.js`, `film-follow-ui.js`, `player-follow-model.js`, `player-tracker.js`, and `player-detector.js` provide film and local player-follow workflows.
  - `stats-import.js` and `stats-import-ui.js` provide preview-first CSV/TSV/XLSX imports.
  - `scouting-model.js`, `scouting-ui.js`, and related scouting files provide opponent history and private player-development workflows.
- `vendor/` contains bundled SheetJS, the local YOLOX-Tiny ONNX model, licenses, and provenance.
- `tests/` contains the Node test suite and focused renderer/package checks.
- `.github/workflows/publish-windows.yml` runs the Windows release validation and publishes Electron artifacts to GitHub Releases.

## Run, test, and build

Install dependencies from the repository root:

```text
npm ci
```

Run the desktop app in development:

```text
npm start
```

Run the full regression suite:

```text
npm test
```

Build Windows artifacts:

```text
npm run dist
npm run dist:portable
npm run dist:installer
```

The Windows batch files are convenience wrappers around dependency installation and these build commands. CI uses Windows, Node.js 22, `npm ci`, `npm test`, and `electron-builder`.

## Data persistence and compatibility

- Season data is stored outside the installed application under `%APPDATA%\ArcticFoxesBY14HockeyAnalytics`.
- The current season file is `foxes-season-data.json`; the previous file is `foxes-season-data.previous.json`.
- Saves validate JSON, write through a temporary file, and preserve the prior file before replacement.
- Coaches can choose a save folder, open it, create season copies, and restore backups through the application.
- Film references point to local files; original video files are not modified.
- Existing legacy game, roster, stats, shift, and metadata fields must be preserved whenever possible.
- Manual coach-confirmed data is authoritative over automatic video inference.
- Never invent player names, jersey numbers, stats, shifts, or identities.

## Current feature set

The current release includes:

- Saved games, rosters, schedules, calendar navigation, backups, restores, and season summaries.
- Official stats entry, CSV/XLSX templates, preview-first imports, exports, normalization, and re-import safeguards.
- Skater and goalie ratings, configurable weights, rating history, honors, trends, and dashboard leaders.
- Local film clips, trimming, break skipping, precise seeking, film notes, and review workflows.
- Manual time-on-ice tracking, shift editing/reassignment/deletion, undo, game-clock anchors, and whistle exclusions.
- Local player detection and player-follow/bench-crossing preview.
- Scoreboard-clock stoppage suggestions that require coach review before application.
- Opponent roster/scoring history, scouting reports, private profiles, evaluations, and encrypted private scouting data.
- Windows auto-update support through GitHub Releases.

Automatic video/player tracking is review-first and experimental. Uncertain detections must never silently create official shifts. Full-game validation has not yet been completed.

## Safety rules for modifying the app

1. Preserve existing functionality and keep the full test suite passing.
2. Do not silently change saved-data schemas or discard unknown fields.
3. Do not invent hockey data or infer identities as facts.
4. Manual coach-confirmed data always wins over automated suggestions.
5. Automatic video/player tracking must remain review-first; uncertain detections may suggest or queue review, but cannot silently create official shifts.
6. Keep automatic features atomic and reversible, with clear status/error messages.
7. Treat existing release notes and historical documentation as append-only history; do not delete or rewrite them to hide prior behavior.
8. Windows remains the primary full film-analysis workstation.
9. Future iPad/mobile work is a companion experience, not a replacement for the Windows workstation.
10. Make precise, localized changes. Add or update focused tests whenever behavior changes.
11. Before implementation, read this file, `ROADMAP.md`, `NEXT_TASKS.md`, and the latest release notes.

## Current development state

v4.2.0 is a locally validated release with stable core manual workflows, improved Film workspace presentation, and the Coach Command Center dashboard. The main unfinished areas are full-game validation of automatic film intelligence, deeper line/goalie analytics, account permissions, and long-term companion-device synchronization.
