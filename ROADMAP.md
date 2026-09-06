# Arctic Foxes 12U AA Analytics Roadmap

## Current implemented state

The v4.1.9 release provides a Windows Electron coaching platform with saved games, schedules, rosters, stats import/export, season analytics, ratings, film review, manual and preview automatic TOI tracking, whistle timing, scoreboard-clock suggestions, opponent scouting, private player development, backups, and GitHub-based updates.

Core manual workflows are test-covered and data is stored in a stable location outside the installed application. Automatic player-follow and scoreboard-clock functionality is intentionally preview/review-first and has not been validated across a complete real game recording.

## Priorities

### 1. Full-game automatic player-follow and TOI validation

- Validate player-follow, detection association, bench crossings, and whistle behavior against complete game recordings.
- Measure false positives, missed crossings, identity loss, camera cuts, occlusion, and recovery behavior.
- Improve detection and review tooling without allowing uncertain detections to become official shifts.
- Preserve manual corrections, audit history, undo, and legacy shift compatibility.

### 2. Better film viewing and analysis layout

- Reduce excessive video zoom and improve responsive sizing across common Windows displays.
- Improve the surrounding film-analysis layout, tool drawers, transport controls, clip navigation, and review context.
- Keep tracking, scoreboard, break review, notes, and film tools understandable without hiding important state.

### 3. Coaching dashboards and visual analytics

- Add useful top-five categories, trends, leaders, TOI, player usage, team trends, and meaningful graphs.
- Keep metrics grounded in recorded data and label coverage, confidence, and missing data clearly.
- Avoid decorative charts that imply conclusions unsupported by the saved data.

### 4. Accounts, roles, and permissions

- Support multiple users safely without allowing assistants, managers, players, or parents to modify sensitive coach/admin data.
- Plan roles for Owner / Head Coach, Assistant Coach, Goalie Coach, Team Manager, Read Only, and future Player/Parent access.
- Require elevated permissions for account and permission management, rating/settings changes, official stats edits, game/season deletion, backup/restore, private scouting notes, player evaluations, and release/update administration.
- Restrict permission management to the Owner / Head Coach and prevent removal of the last full-access administrator.
- Design authentication, authorization, auditability, and recovery together before implementation; do not change current single-user behavior until the model is fully specified.

### 5. Line and defensive-pair analytics

- Build reliable line-combination and defensive-pair summaries from confirmed shifts.
- Include shared ice time, usage, goals/chances where supported, and sample-size context.
- Respect whistle exclusions, clip boundaries, manual corrections, and incomplete shifts.

### 6. Better postgame coach reports

- Improve printable and exportable postgame reports.
- Combine score, usage, TOI, player notes, film references, ratings, and coach-entered conclusions.
- Make reports useful for staff review while distinguishing official stats from estimates and suggestions.

### 7. Continued scouting and opponent-history improvements

- Improve opponent roster/scoring ingestion, identity review, historical aggregation, and report generation.
- Expand opponent tendencies and matchup context without fabricating missing data.
- Preserve private scouting boundaries and encrypted storage behavior.

### 8. Player-value and development tools

- Improve player profiles, development evaluations, trend views, role context, and coach notes.
- Make player value explainable and connected to evidence rather than a single opaque score.
- Preserve private notes and identity links across roster changes.

### 9. Goalie analytics improvements

- Add better goalie workload, save-quality, game-state, rebound, and usage context where data exists.
- Keep goalie calculations separate from skater formulas and avoid unsupported shot-quality claims.
- Clearly identify which values are imported, manually entered, or derived.

### 10. Print Center and Coach Center improvements

- Improve print-ready game-day, scouting, postgame, schedule, and season reports.
- Continue simplifying Coach Center navigation and make the most useful actions prominent.
- Validate print layout on Windows and preserve accessible text/status behavior.

### 11. Long-term iPad/mobile companion and synchronization

- Treat iPad/mobile as a companion experience, not a replacement for the Windows workstation.
- Define a durable synchronization model, conflict policy, authentication, and offline behavior before implementation.
- Synchronize approved data safely with the Windows application while preserving local backups and coach authority.
