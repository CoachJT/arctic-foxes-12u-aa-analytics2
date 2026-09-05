# Arctic Foxes 4.1.2 — Balanced Overall Ratings

Rebalances the default skater overall to goals and assists 30%, plus/minus 15%, shots 15%, blocked shots 15%, faceoffs 10%, ice-time efficiency 10%, and discipline 5%.

- Disabled or missing ice time is excluded and remaining category weights are normalized. Players with no faceoffs have that category excluded.
- Faceoff scores are pulled toward neutral with ten neutral prior draws, reducing swings from tiny samples without altering the recorded faceoff percentage.
- Existing custom category weights are preserved. Choose **Season Stats → Rating Weights → Use balanced defaults** to reset custom weights to this balance.
- Category labels now use familiar stat names. An additional analytics view now respects the ice-time toggle.
- Overall ratings remain on a 0–100 scale with two neutral prior games. The separate goalie and MVP/star formulas are unchanged by this rebalance.

Saved player stats, games, film, private scouting, and the stable season-data path are preserved. Rating histories recalculate from existing games.

Validation: 84 automated tests, including faceoff sample confidence, weight normalization, custom weights, ice-time exclusion, and saved-data preservation.
