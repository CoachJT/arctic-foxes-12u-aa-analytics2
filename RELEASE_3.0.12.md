# Arctic Foxes Hockey Analytics 3.0.12

Built incrementally from 3.0.11 (91250148721ca3975c5b34994dd6d83e140d41e5).

- My Games is a primary sidebar page with overview, game entry, film, shifts, ratings and reports.
- Quick Stats saves into the working game's existing officialStats snapshot; season totals, profiles, trends and dashboards derive from saved games.
- Legacy number-keyed records, quick-entry arrays, local quick-entry drafts, shot/block/plus-minus aliases and historical goalie saves are normalized without deleting their source metadata. Existing game metadata survives snapshot saves.
- Season Stats provides skater and goalie totals. Manual TOI is in minutes; a blank TOI override uses existing film shifts. GP is entered per game; entering nonzero stats selects GP 1.
- Foxes Player Rating starts at 50.0, uses bounded Game Ratings and recalculates season rating as `(100 + sum(game ratings)) / (2 + games played)`. The two neutral prior games stabilize early-season results. Faceoffs and TOI are omitted when unavailable; more minutes alone do not earn points. Skater weights are adjustable on Season Stats. Goalies have a separate save percentage / GAA / workload / result / shutout formula.
- Enlarged film keeps precision seeking, player/event tags, F/D ON/OFF, clock, pause-on-tag and undo accessible. Existing shift, clip, sync, tagging and CSV functions are reused.
- Removed the stale auto-publish banner and updated version branding.

## Data and updater safety

`main.js` and `preload.js` are unchanged. The userData directory remains `ArcticFoxesBY14HockeyAnalytics`; the existing storage filenames and backup logic remain intact. No installed season data was opened or modified during testing.

The updater still publishes to `CoachJT/arctic-foxes-12u-aa-analytics2` with artifact name `Arctic-Foxes-12U-AA-Hockey-Analytics-${version}.${ext}`. The GitHub Actions pipeline checks the source before publishing and refuses to replace a tag from a different commit or overwrite uploaded assets. This release uses a new v3.0.12 tag.

## Validation

- `npm test`: normalization, season edits/deletion, goalie math, rating bounds/efficiency, neutral baseline, save snapshot preservation, precision seeking, JavaScript syntax and release invariants.
- Browser QA on an isolated localhost origin: create/open a game, save skater and goalie stats, reload, edit, view season totals, profile and report, and open the shift picker in enlarged film.
- `electron-builder --win nsis --publish never`: Windows installer, blockmap and latest.yml validation.
- Production dependency audit: zero known vulnerabilities. Full audit reports two high-severity entries for the Electron development dependency and its extract-zip dependency; npm reports no available fix. Dependency ranges remain unchanged.
- Build warnings: the project uses the default Electron icon and has no package author metadata. No code-signing certificate is configured.

Real LiveBarn playback and a complete installed-app upgrade against a coach's season data were not exercised; testing preserves the installed data by using an isolated browser origin and synthetic records.
