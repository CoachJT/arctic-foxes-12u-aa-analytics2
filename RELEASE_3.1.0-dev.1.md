# 3.1.0-dev.1 — Coach Command Center

Development prerelease based on 3.0.16, including the 3.0.14 tracking engine and subsequent bench-zone/import fixes.

## Implemented

- Coach Center: record, GF/G, GA/G, weighted PP/PK/FO rates, shot differential, Last 5, selectable Top 5 categories, team/player trends and player/game navigation.
- Film: full-frame Fit default, optional Fill, Theater, Fullscreen, collapsible analysis/setup/review, independent bench/track/motion/crossing overlays, keyboard playback/seeking, and tagged bookmarks associated with game, clip and optional player.
- Import: mixed skater/goalie/team/period sections and all worksheets in the supplied workbook, jersey-first matching, preview/confirm, partial-value preservation and calculated percentages. Goalie S retains the established saves interpretation; GAA retains the 36-minute basis.
- Game overview: score, period goals/shots, special teams, faceoffs, goalies, points leaders and confirmed TOI leaders. More game tools contains Game Day, Shift Timeline, Lines & D-Pairs, Clips, Coach Notes and Data Quality.
- Timeline seeks the source clip; line usage sums exact confirmed forward-trio and defense-pair overlaps without joining different clips.
- Private game/player notes and pregame plans use additive per-game fields. Tracking audit entries preserve before/after corrections; existing Undo remains available.

## Compatibility

Unchanged application ID, product/shortcut name, user-data folder, season-file name, updater repository and versioned artifact naming. No roster replacement. Existing metadata and bench zones are retained. Notes/bookmarks use command31; tracking audit is additive inside toi314. Notes are excluded from the game report but are included in season backups; they are not encrypted or protected by separate user accounts.

## Validation and release constraints

57 automated tests cover the existing regression suite and new imports, aggregation, overlap, quality, audit, additive persistence and script/package checks. Interactive browser smoke checks cover import preview/confirmation, the actual 17-player workbook, dashboard/player navigation, Fit/Fill/Theater/Fullscreen, timeline seeking, notes and bench-zone reopening. Film checks use a generated local 960×540 clip rather than a full LiveBarn game.

Installer and portable builds are validated separately because their historical artifact names are identical. dist:portable writes into dist/portable; dist:installer retains the default dist destination. Neither publishes. release/publish commands retain the existing release channel and must not be used until approved.

## Remaining development limitations

- Auto Track remains an alpha motion/crossing detector; it does not identify players automatically.
- Exact overlap usage excludes extra-player combinations and requires confirmed video intervals. GF/GA, shots and chances together are not attributed yet.
- Game Day plans are coaching notes; they do not automatically alter the live line-switching controls or starting-goalie selection.
- Player notes are scoped to a selected game. Cross-game note aggregation, bookmark editing/deletion and exported clip playlists remain future work.
- Quality flags describe recorded coverage and unresolved items; they cannot prove every real shift was captured. Finalization still requires coach review.
- Browser-local film needs reattachment after a browser restart; desktop persistent film paths retain existing behavior. A full-game installed-desktop LiveBarn acceptance pass remains recommended before a stable release.

Recommended development version: 3.1.0-dev.1. Promote to 3.1.0 only after full-game coaching acceptance and publication approval.
