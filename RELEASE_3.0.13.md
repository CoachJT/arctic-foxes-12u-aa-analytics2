# Arctic Foxes Hockey Analytics 3.0.13

Focused interface redesign based on 3.0.12 (`e147a5145a0340f1a1b95fdbdfdb1382f61eacd5`).

- Charcoal/red design system across navigation, dashboards, forms, tables, dialogs, scouting, tracking, film, and player development.
- Coach Command Center with next-game actions, reliable team snapshot, performance leaders, and recent-game links. Missing scores are explicitly unrecorded; default 0–0 values do not invent ties. Record and goal totals identify their scored-game coverage.
- Clear My Games header and tabs; scrollable season tables; distinct rating values, movement, and history. Rating weights remain available in a collapsible section.
- Larger film area and consistent precision tagging controls, retaining the existing fullscreen behavior.
- Dedicated Updates page; no update panel or global Undo/CSV bar on Coach Center. CSV identifies the current game; Undo appears only with reversible work.
- Useful first-use states for games, stats, ratings, and film.

## Compatibility

The 3.0.12 analytics engine, game-management integration, Electron main process, and preload bridge are unchanged. No saved-data migration or storage-path change is introduced. The new dashboard helpers are read-only.

- userData: `ArcticFoxesBY14HockeyAnalytics`
- GitHub updater: `CoachJT/arctic-foxes-12u-aa-analytics2`
- Artifact: `Arctic-Foxes-12U-AA-Hockey-Analytics-${version}.${ext}`

## Validation

- All 15 automated tests pass, including existing normalization, rating, aggregation, save/metadata preservation, and precision-seek tests.
- New presentation tests cover score availability, score coverage, next-game selection, leader eligibility, no mutation of saved data, unchanged engine outputs, and contextual actions.
- Syntax parsing covers all inline scripts and renderer/main/preload JavaScript; package version, updater, artifact naming, and userData invariants are checked.
- Browser checks use isolated test storage: existing 3.0.12 game stats load, a game edit updates season totals, and the QA edit is restored. Checked all sidebar destinations, My Games tabs, next-game stat action, ratings, empty states, fullscreen tagging/Undo, Updates, and desktop layout.
- Local Windows NSIS build and packaged-source/update-manifest checks are performed before commit. GitHub Actions repeats tests and builds the published installer.

## Remaining limitations

The installer retains the existing unsigned/default-icon configuration and missing-author build warning. No dependency changes are included; existing development dependency audit findings remain. Real LiveBarn playback and installing an update over the coach's live season were not exercised; the installed season was not used for testing.
