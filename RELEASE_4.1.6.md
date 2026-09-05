# Arctic Foxes 4.1.6

- Simpler fullscreen film: full-width video, compact playback controls, and one tool panel at a time.
- Sound enabled with mute and volume controls beside playback.
- Pause ice time during a whistle while video keeps playing. Player changes still work during stoppages; stopped time is excluded from tracked totals and line-combination time.
- Follow players preview: manually attach names to visible players, then record shifts from their bench-line crossings. Uncertain matches pause playback for reconnection. Labels must be reattached after reopening film and cannot guarantee identity through overlap or an unseen bench.

Existing saved games, coach-entered stats, and the stable data location are preserved. Coach-entered official time retains precedence. Player following was verified with synthetic video, not a complete game recording.

Validation: 100 automated tests passed; isolated Electron checks covered sound controls, whistle timing, fullscreen geometry, player attachment, and canceling without changes.
