# Shot Intelligence v1 contract

Migration `020_shot_intelligence.sql` adds `public.shot_events`, the canonical event model for manual, film, and trusted automated sources. It is intentionally independent of PNX Impact and does not alter official game totals.

## Coordinates and results

Coordinates use feet relative to rink centre: `x` is the length axis in `[-100, 100]`, `y` is the width axis in `[-42.5, 42.5]`. `raw_x/raw_y` preserve capture orientation. `normalized_x/normalized_y` point toward the attacking net; the producer must explicitly provide `attackingDirection` (`1` or `-1`) rather than silently flipping data.

`GOAL` and `SAVE` are shots on goal. `MISS` and `BLOCK` are attempts but not shots on goal. Zone classification is deterministic and exposed by `shot_event_read_model`: `CREASE`, `LOW_SLOT`, `LEFT_CIRCLE`, `RIGHT_CIRCLE`, `LEFT_POINT`, `RIGHT_POINT`, `LEFT_LOW`, `RIGHT_LOW`, and `OTHER`.

## Entry and identity contract

The future rink-click flow supplies game, period, shooting context, optional managed roster shooter/goalie, coordinates, result, source, and an idempotency key. Opponent events set `is_opponent_event = true` and may use `opponent_team_name`, `shooter_display_name`, `shooter_jersey_number`, and `goalie_display_name`; they never create fake roster memberships. Managed players are checked against the workspace team server-side.

Manual corrections update the row and may set `voided_at`, `voided_by`, and `void_reason`. Idempotency is enforced by a partial unique index on `(team_id, idempotency_key)` that excludes voided rows: a duplicate submission within its team scope is rejected, a coach can void a mistaken entry and resubmit with the same client-generated key, and legitimate distinct shots (different or omitted keys) always remain separate.

## Reads and completeness

`shot_event_read_model` is a frontend-neutral coordinate/result payload. `shot_zone_summary(...)` supports team, player, goalie, opponent, season, and date filters and returns attempts, SOG, goals, saves, shooting percentage, and sample zones. `shot_event_game_reconciliation` compares event counts with canonical `team_game_team_stats` totals without changing them. Completeness is one of:

- `UNKNOWN` — canonical shots-for/against totals are not available for this game.
- `COMPLETE` — recorded events exactly match the canonical total(s).
- `PARTIAL` — recorded events are fewer than the canonical total(s); expected during incremental/incomplete manual entry.
- `MISMATCH` — recorded events exceed the canonical total(s), a genuine contradiction (duplicate entry, bad canonical data) that must never be folded into `PARTIAL` or presented as ordinary incomplete coverage.

`shot_zone_summary` rolls per-game completeness up per zone, with `MISMATCH` taking priority over `PARTIAL`/`COMPLETE` in that rollup so a contradiction is never hidden behind an otherwise-complete zone.

## Security and limits

RLS requires `stats.view` to read and `stats.edit` to create/update. Direct client inserts must use the authenticated user as `created_by`, cannot claim `automated`, and are validated against organization/team/season/game relationships. Trusted automated writes require the service role. The v1 contract does not include UI, raster heatmaps, video assets, scouting claims, or statistical confidence intervals; video timestamp and metadata fields are reserved for future Film Room linkage.

## Known v1 limitations

- The zone model intentionally omits a separate `HIGH_SLOT` zone. The strip `x ∈ [35, 60)` with `|y| ≤ 18` (between the circles, short of the low-slot threshold) classifies as `OTHER` rather than a slot zone. This is deterministic and locked by a boundary test, but is a candidate for a v2 zone refinement once real shot data volume justifies a finer model.
- Zone boundaries, coordinate bounds, and result semantics are fixed constants in both the SQL view and the JS module; a future rink-size or zone-model change requires updating both in lockstep.
