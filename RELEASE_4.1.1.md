# Arctic Foxes 4.1.1 — Film and Rating Fixes

- Add Clip opens the newly selected video, including when an older clip is unavailable. Reselecting the same file preserves its clip identity. Video loading and file-picker failures now display actionable messages.
- Fullscreen controls share one layout, keep playback controls visible, and exit consistently with Escape. Fit and Fill remain available.
- The ice-time switch now applies to player ratings and MVP/star honors. It defaults off when no preference has been saved; an explicit existing preference is retained. Recorded minutes are preserved, and excluded categories are redistributed across the remaining rating weights.
- Scoring chances no longer contribute to grades or MVP/star honors and are removed from the regular game-entry columns. Existing recorded data is retained. Category percentages are unchanged.
- Schedule uses one collapsible add/edit form. Coach Lab uses clear task labels instead of old version numbers.

Existing season-data location, saved games, player statistics, private scouting, and app identity are preserved.

Validation: 81 automated tests plus isolated Electron checks for rating controls, schedule add/edit, fullscreen and Escape, Fit/Fill, and real local-video loading and failure handling. The reported individual video was unavailable for inspection; this release fixes the verified loading-flow issues and adds error feedback.
