# 3.0.14 - TOI Tracking + Auto Track Alpha

Based on current main at `c8a96979d135c2fa14749a1d0ea2e05fe088365f` (published 3.0.13). The interface redesign and existing analytics remain intact.

## Implementation

- Manual Track roster toggles, ON ICE NOW, and live TOI use `video.currentTime`. Pausing does not advance duration. A seek with active video shifts pauses playback and requires explicit acknowledgment or returning to the previous position. Cross-clip OFF transitions are rejected because gaps cannot be inferred reliably.
- Native video shifts extend the existing per-player shift arrays, retaining aliases consumed by season stats. Legacy shifts are read without rewriting them. Explicit legacy corrections retain the original record as `legacyOriginal`.
- Shift Log supports video jumps, timestamp corrections at 0.25/1-second precision, reassignment, confirmation and deletion. Existing Undo restores snapshots; new unreviewed automatic candidates survive undoing earlier manual work.
- Per-game `toi314` stores clip-specific zones, detection candidates, confirmation ground truth, correction/deletion audit entries, and finalization status. Snapshot/load/reset paths keep games isolated. No installed data-path change.
- Sync anchors provide estimated period/game-clock labels. Video ON/OFF difference remains authoritative; clock stoppages require additional anchors. TOI summaries include confirmed completed shifts, count, average, longest, shortest and known start-period totals. Shifts longer than 65 seconds are neutral review flags.

## Actual detector

Local canvas frames are sampled during playback approximately every 0.1 seconds at 320-pixel width. Grayscale frame differencing uses a fixed intensity threshold, connected components locate moving regions, nearest-centroid association links regions between samples, and a trajectory changing sides across the configured boundary produces an ON/OFF candidate. A dead band, minimum trajectory age, per-track cooldown and nearby-time deduplication reduce noise. Large frame changes and timeline discontinuities reset trajectories.

No network inference, person-recognition model, jersey recognition, training or cloud video upload is used. Every identity starts UNKNOWN PLAYER. Confirmation requires a roster assignment and valid ON/OFF state; candidates alone contribute no official TOI. High/medium/low scores are heuristic evidence scores, not calibrated probabilities or measured accuracy.

Debug View displays the saved region, bench/ice orientation, crossing boundary, moving-region boxes, track IDs/sides and most recent crossing with timestamp and confidence score. Processing is bounded per playback frame, can be cancelled, and errors stop analysis without modifying manual shifts. Keep the film active during analysis; this is playback-time analysis, not a guaranteed background/offline full-file scan.

## Validation status

- 31 automated tests pass, including existing analytics/data preservation/syntax invariants and new manual state, video duration, edits, actual Undo, candidate review, reassignment, rejection, game-clock conversion, legacy compatibility, per-game persistence and synthetic pixel crossing tests.
- Windows NSIS packaging and packaged-source/update-manifest validation are performed before publication.
- Interactive local-video checks passed: paused TOI stays fixed; precision corrections and Undo work; two-corner zone drawing persists; fullscreen controls and debug overlays remain usable; cancellation works; unknown ON/OFF candidates require assignment and confirmation; finalized totals survive reload. The 12-second synthetic video produced two crossings, confirmed as one 5.45-second shift. No browser JavaScript errors were reported.
- No representative hockey video was found in the repository. Synthetic moving rectangles test the algorithm, not real-world LiveBarn accuracy.

## Limitations and release gate

Frame differencing cannot reliably distinguish players from shadows, sticks, board motion, spectators or camera movement. Crowded changes may merge/split tracks or create duplicate/missed detections. Fixed thresholds depend on camera scale, lighting, compression and sample rate. Fast playback or hidden/background rendering can miss motion. Use a fixed view, a tight bench zone and coach review. No accuracy percentage is claimed.

Preserve `ArcticFoxesBY14HockeyAnalytics`, updater repository `CoachJT/arctic-foxes-12u-aa-analytics2` and artifact template `Arctic-Foxes-12U-AA-Hockey-Analytics-${version}.${ext}`. No previous tags/assets may be replaced. Commit only after the remaining checks with `Release 3.0.14 - TOI Tracking and Auto Track Alpha`, then push main and verify Actions and the new release.

Existing unsigned/default-icon and missing-author packaging warnings remain.
