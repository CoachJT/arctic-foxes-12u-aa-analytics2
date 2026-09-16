# PuckNexus coach workspace redesign

Branch: `redesign/coach-workspace`

Baseline: `557d104e4900d739b1b6452f6fd3cd3caca21381`

## What changed

- Five primary destinations: Command Center, Game Center, Schedule, Player Profiles and Film Room. Insights and management are grouped in expandable navigation sections. Capability checks still determine which destinations are visible.
- Command Center prioritizes action items, quick actions, the next game and the season snapshot. Recent games open the selected game directly. Goalie detail and trends are expandable.
- Game Center focuses on one selected game, with opponent/date/score context, Overview, Skaters and Goalies sections, final-score correction, stat entry and the existing scoped Film Room route. Missing values display as dashes; future games cannot open stat entry.
- Stat entry supports position-grouped player selection and quick increments over the existing draft. Bulk numeric entry remains available, including negative plus/minus. Undo restores the previous draft row and dirty state; undoing a player's first event does not create a zero-stat appearance. Goalie shots against and save percentage derive from saves and goals against.
- Explicit saving, visible failure/retry, a persistent mobile Save control, protection against navigation with unsaved drafts, and locking edits during a save. The existing save payloads and RPCs are unchanged.
- Roster presentation sorts forwards, defense and goalies by numeric jersey number. Mobile shows player cards. Roster maintenance and bulk paste are expandable; all existing add/edit/remove operations remain available.
- Shared charcoal, white and red styling, keyboard focus indicators, a skip link, responsive navigation and reduced-motion support. Schedule creation is expandable.

## Validation

- `npm test`: **397 passed, 0 failed** (387 existing tests plus 10 new behavioral tests).
- `node --check` passed for every web JavaScript file and the local preview script.
- `git diff --check` passed.
- Browser review: desktop 1440px, tablet 820px, mobile 390px, and narrow mobile 320px. No page overflow in the checked Game Center/stat-entry views. Reviewed mobile roster cards, navigation, quick increments, undo, goalie selection, bulk entry, simulated save success/failure and future-game restrictions.
- Updated existing cache-version assertions and the reload assertion to reflect the async callback that restores the active view after saving.

## Local design review

Run `npm run preview:redesign`, then open `http://127.0.0.1:4178/?prototype=1`.

This preview serves the actual web UI with clearly labeled illustrative fixtures and a stub client. It binds only to loopback and blocks network connections through CSP. It does not contact Supabase. Save responses are simulated; fixtures reset on reload and do not represent actual team records. To exercise the failure state use `http://127.0.0.1:4178/?prototype=1&fail=1`.

The web app is static: the existing Pages workflow uploads `web/` directly. There is no separate web compilation step. Windows packaging was not run because this branch changes the web workspace, not the Electron application.

## Review boundaries

No Supabase configuration, database functions, migrations, permission definitions, authentication implementation, deployment workflows or Windows application files were changed. No migrations were created or applied, and no deployment or merge was performed.

Live authenticated saves, Film uploads/playback and real backend behavior were not exercised. Existing automated persistence tests pass, but production integration should be verified in a separately authorized release review. Shifts, shot/faceoff locations and game notes remain in the Windows workspace, as at baseline; the web redesign does not invent unsupported data or controls. Save remains explicit rather than claiming autosave.

## Visual refinement

Added a hockey arena backdrop, condensed sports typography, team crests (existing uploaded logos when available, initials otherwise), a centered game scoreboard, compact player leaders and recorded-stat comparisons. The Command Center now leads with team identity and the next game, followed by actions, attention items and season metrics. The arena image is AI-generated decorative artwork, not a photograph of a team venue. Unknown comparison values remain unavailable and do not display a comparison bar.

Repeated the full 397-test suite and desktop/mobile browser review after this pass, including 320px Game Center and quick entry overflow checks.
