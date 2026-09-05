# 3.0.15 - Stats Import and Saved Bench Zones

Import per-game stats from Excel (.xlsx), CSV, or cells pasted from Google Sheets. Select a worksheet, review matched players, values and warnings, then Confirm Import to save to the open game.

- Matches jersey numbers first, then normalized player names. Unmatched and duplicate rows are skipped with warnings.
- Supports skater and goalie fields, including faceoffs and special teams. Blank cells preserve existing values; explicit zero replaces a value. Reimporting replaces values rather than adding duplicates.
- Download a CSV or Excel template populated with the current roster. Excel support is bundled for offline use (SheetJS CE 0.20.3, Apache 2.0).
- Imported stats use the existing saved-game and analytics paths for profiles, season totals, trends and reports. Existing data paths, updater settings and tracking data remain compatible.
- Bench zones save per clip/game, reload boundary settings, validate coordinates and prevent unsaved drafts leaking between clips.

Validation: 46 automated tests cover existing tracking and saved-data behavior, import parsing and matching, template round trips, confirmation, cancellation and analytics. Windows packaging is checked before publishing.

Real-game spreadsheet usability and representative LiveBarn accuracy remain unvalidated. Auto Track remains an alpha requiring coach review. Existing unsigned/default-icon packaging warnings remain.
