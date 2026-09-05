# Arctic Foxes 4.1.4 — One Bench Line

- Replaces the rectangle editor with Draw line, Save line, and Clear line controls. Drag a line or click its two endpoints.
- Removes the duplicate game-wide marker from the video. Each clip keeps its own saved line, and overlays stay hidden when no video is loaded.
- Auto Track evaluates crossings against the drawn line, including diagonal lines. Bench-side selection determines ON/OFF direction. Crossings still require player assignment and confirmation before recording ice time.
- Existing rectangular zones remain readable and show their crossing boundary as a single line. Existing legacy marker data and recorded shifts are preserved.
- Includes the prior rating rebalance and Film wording cleanup. This release does not further change the overall-rating scale or weights.

Validation: 86 automated tests plus an isolated Electron check of line draw/save, switching clips, clearing, and hiding the old overlay. Synthetic pixel tests cover diagonal crossing direction. Saved season and private scouting locations are unchanged.
