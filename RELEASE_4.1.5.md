# Arctic Foxes 4.1.5 — Overall Ratings Start at 70

- New and unplayed players start at 70.0 overall.
- Game and season ratings use a wider fixed 0–100 scale, making performance differences easier to see while preserving the ordering of underlying scores.
- Season ratings apply the scale after averaging underlying game scores with two neutral prior games. History recalculates from existing games rather than adding a permanent boost.
- Goalies retain their separate underlying formula and sample confidence. Category weights, custom weights, ice-time controls, and recorded stats are unchanged.
- Rating explanations and starting-baseline labels reflect the new scale. Category breakdowns remain the underlying inputs, rather than the expanded overall.

Includes the prior single bench-line editor and Film Room cleanup. Saved games, shifts, film references, private scouting, and the stable season-data location are preserved.

Validation: 89 automated tests covering the starting baseline, ordering, bounded scale, raw-score averaging, confidence, custom weights, and data preservation. Compared the recalculated scale with the saved season using read-only data.
