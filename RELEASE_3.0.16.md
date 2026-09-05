# 3.0.16 - Easy Game Stats Import

Import Stats, Export Stats, and Download Stats Template now appear together on My Games > Enter Stats and Quick Stats. Import Stats opens the per-game spreadsheet import panel.

Choose Excel (.xlsx), CSV, or paste Google Sheets cells; review matched players, values, skipped rows and warnings before Confirm Import. Jersey matching takes priority over normalized names. Blank cells preserve saved values and repeated imports replace values without double counting.

Adds common Player # and Jersey # headers and support for scoring chances, takeaways, and giveaways. Export Stats creates a roster-based game box score compatible with the importer. The film tracking export remains available separately.

Saved-data compatibility and bench zones are preserved. Nothing changes in saved games until an import is confirmed.

Validation: all 49 automated tests passed, renderer and main-process syntax checks passed, an isolated rendered-app check confirmed visible controls and selected-game saving, and local Windows packaging passed before the version bump. The release workflow validates the versioned source and builds the installer.
