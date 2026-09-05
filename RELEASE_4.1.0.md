# Arctic Foxes 4.1.0 — Private Scouting & Tryouts

Adds a separate password-protected scouting workspace for season-long opponent tracking and tryout evaluation. Choose **Private scouting ↗** in the app and set your password on first use.

## Private scouting

- Automatic player profiles from saved opponent scoresheets and reviewed roster imports (paste, CSV/TSV, or local photo recognition).
- Season and team filters, watchlists, position/birth-year details, roster-fit notes, and dated game/practice/tryout observations.
- Side-by-side comparisons with Foxes players, with sample sizes, missing stats, and source coverage visible. Roster entries alone do not count as games played or receive ratings.
- Repeated exact identities combine; possible name/number changes are flagged for review. Source corrections recalculate stats without double counting.
- Private information is encrypted locally with AES-256-GCM and a password-derived key. The workspace locks after five idle minutes, on minimize, and on Windows lock/sleep.

Keep your password safe: there is no password recovery. Private scouting data is stored separately from normal season backups; retain the encrypted scouting file when backing up or moving computers. Unsaved form edits are cleared on locking. Existing opponent stats remain visible in the normal app.

## Included from the local 4.0 build

The last public release was 3.1.2. This release also includes the local 4.0 dashboard and navigation, position-grouped team jerseys, game MVP/star honors, opponent scoresheet import and rankings, and assisted film player-example comparison. Film identity suggestions remain experimental and require confirmation; they do not automatically assign time on ice.

## Preserved and validated

- Existing application ID, stable season-data path, saved games, and updater repository are preserved.
- Private scouting edits do not write to Foxes season statistics. Existing player-rating weights are unchanged.
- 78 automated tests passed, plus the isolated desktop workflow test covering password setup/unlock/rejection, roster review, private notes, evaluations, comparison, encrypted persistence, automatic refresh, and locking.

Photo recognition can misread handwriting or rotated images. Review every imported name and number before saving.
