# Game Center + Stats 2.0 Phase B contract candidate

This document describes the corrected Phase A review artifact. It is not approval
to apply the migration or build Phase B. Supabase, LIVE, Edge Functions, and
remote data remain out of scope until a separate design/security review and
authorized read-only production preflight pass.

## Current review status

- Phase A is a local review artifact only.
- The artifact is based on current `origin/main`, not the obsolete branch base.
- The repository has no identified canonical OT-occurrence field in
  `team_games` or `team_schedule_games`.
- Because OT applicability is unresolved, Phase B must not treat this contract as
  complete or infer OT from score, scoreless OT goals, notes, tied scores, or
  optional OT shot entries.

## Data added by Phase A

`public.team_game_team_stats` gains nullable integer period-shot columns:

- `shots_for_p1`
- `shots_for_p2`
- `shots_for_p3`
- `shots_for_ot`
- `shots_against_p1`
- `shots_against_p2`
- `shots_against_p3`
- `shots_against_ot`

Period-shot values are whole, nonnegative integers. `NULL` means unrecorded, or
for OT only may also mean not applicable after an approved OT authority exists.
Explicit `0` means the coach recorded zero.

Existing team-level fields remain in place:

- total shots: `shots_for`, `shots_against`
- special teams: `power_play_chances`, `power_play_success`,
  `penalty_kill_chances`, `penalty_kill_success`
- team faceoffs: `faceoff_wins`, `faceoff_losses`
- score and period goals: existing score/stat paths only, not the new Team Stats
  RPC

## Save RPC

Candidate signature:

```sql
public.save_game_team_stats(
  target_team_id uuid,
  target_season_id uuid,
  target_source_game_id text,
  payload jsonb
)
```

The RPC is patch-style. Omitted accepted keys preserve the current value. Explicit
JSON `null` clears nullable editable values, subject to pair and total rules.
An empty object is rejected so Game Center cannot create a row that only marks a
game as having stats. JSON null, arrays, scalars, booleans, and unknown keys are
rejected.

Accepted keys:

- `shots_for`, `shots_against`
- `shots_for_p1`, `shots_for_p2`, `shots_for_p3`, `shots_for_ot`
- `shots_against_p1`, `shots_against_p2`, `shots_against_p3`,
  `shots_against_ot`
- `power_play_chances`, `power_play_success`
- `penalty_kill_chances`, `penalty_kill_success`
- `faceoff_wins`, `faceoff_losses`

Rejected keys include all score and period-goal fields:

- `goals_for`, `goals_against`
- `goals_for_p1`, `goals_for_p2`, `goals_for_p3`, `goals_for_ot`
- `goals_against_p1`, `goals_against_p2`, `goals_against_p3`,
  `goals_against_ot`

`save_game_score` remains the intended quick-score UI path, but it is not the
literal only database score writer because existing `save_game_stats` also writes
score fields. This new RPC is score-isolated and does not write score, period
goals, player/goalie rows, or season-record rollups.

### Score-write architecture note (verified, unchanged in Phase A)

Real-PostgreSQL inspection of the existing migrations confirms the dual-writer
condition was already present before Phase A and is **not** introduced or
worsened by this work:

- `save_game_stats` (`20260908073105_016_game_stat_entry.sql`) accepts an
  arbitrary payload and writes `team_game_team_stats.goals_for` /
  `goals_against` directly from caller-supplied JSON, alongside player/goalie
  rows, in one transaction.
- `save_game_score` (`20260915000100_027_game_score_entry.sql`) is a narrower,
  dedicated score-only writer that also writes the same `goals_for` /
  `goals_against` columns and recomputes the season record.
- Both are `SECURITY DEFINER`, both are grantable to `authenticated`, and both
  can write the same score columns on the same row for the same game. This is
  a genuine pre-existing dual-writer condition, confirmed by direct migration
  inspection (not inferred).
- Phase A's new `save_game_team_stats` RPC deliberately does **not** touch
  either code path or either column, proven by an automated real-PostgreSQL
  test (`score isolation`, see `tests/game-center-stats-phase-a-postgres.test.cjs`).
- **No change was made** to `save_game_stats` or `save_game_score` in this
  pass. Consolidating them onto a single authoritative score writer is a
  separate, higher-risk change (it requires auditing every existing caller of
  `save_game_stats` for score-field usage) and is out of scope for Phase A.
  `save_game_score` is **not yet** the sole authoritative score path in the
  running system; it is only guaranteed to be the sole score path reachable
  through Phase A's new RPC.

## Total-shot behavior

Totals are derived server-side only when all applicable periods for that side are
recorded.

Until an approved OT-occurrence authority exists:

- regulation total derivation uses P1 + P2 + P3 when all three regulation
  periods are present
- OT values may be stored as raw period-shot entries, but they do not make an
  unknown-applicability total authoritative
- if regulation periods are incomplete, the stored historical total is preserved
- explicit `shots_for` / `shots_against` legacy total inputs are accepted only as
  compatibility inputs
- when a derived total exists, a supplied legacy total must match it
- when no derived total exists, a supplied legacy total may update the total
- explicit total `null` does not erase a preserved historical total unless the
  approved contract is later changed to allow that

Examples:

- P1/P2/P3 = `8/11/9` derives total `28`.
- P1/P2 present and P3 omitted preserves the current stored total.
- P1/P2/P3 = `8/11/9` plus `shots_for: 999` is rejected.
- P1/P2/P3 = `0/0/0` derives explicit total `0`.

## OT applicability

No existing authoritative OT-occurrence field was found in the current schema.
`goals_for_ot` and `goals_against_ot` are raw period-goal values and cannot prove
whether OT occurred because scoreless OT is possible. Tied score, notes, date,
period length, or optional OT shot values are not acceptable authorities.

Required product/database decision before this contract can be complete:

- regulation game: define a canonical value proving OT did not occur; OT shot
  fields are inapplicable and should stay `NULL`
- OT game: define a canonical value proving OT occurred; all applicable OT shot
  fields are part of total derivation
- unknown applicability: do not derive OT-inclusive totals and do not coerce
  `NULL` OT shots into zero

Phase B must surface this as a blocked design decision rather than silently
guessing.

## Season integrity

The RPC requires `target_season_id`. It validates:

- caller authorization for `(team, season, stats.edit, stats)`
- the selected season belongs to the selected team through existing helpers
- `team_games` ownership by team/source game
- `team_schedule_games` ownership when a linked schedule row exists
- existing `team_game_team_stats` ownership and season

Existing stats cannot move to another season and cannot be cleared to a null
season by this RPC. Legacy null-season game/schedule rows may be adopted only when
there is no existing conflicting team-stat row; the game and linked schedule rows
are locked and updated atomically. Existing null-season stat rows are rejected for
manual resolution rather than silently reparented.

Concurrent saves use row locks and conflict predicates so season changes,
schedule adoption, and stat updates fail closed if another writer changes the
same game concurrently.

## PP/PK behavior

For the new RPC, PP/PK values must be finite, whole, nonnegative integers.

Pair rules:

- unrecorded pair: both values are `NULL`
- recorded pair with no opportunities: `0/0`
- recorded successful opportunities: both present and success cannot exceed
  opportunities
- partial pairs such as `5/NULL`, `NULL/0`, or `NULL/1` are rejected

PP% and PK% are derived display values only. If either pair is unrecorded,
percentage is unknown. `0/0` is a recorded no-opportunity state and must not
render as a divide-by-zero error.

The migration does not add a stricter immediate table CHECK over the existing
numeric PP/PK columns yet. Historical data and legacy/direct authorized write
paths must first be evaluated by the prepared read-only preflight. Dirty rows
must not be auto-repaired or zero-backfilled. `NOT VALID` may be considered in a
later approved migration, but it still affects new/updated rows and does not by
itself solve compatibility with remaining write paths.

## Security and scope

The RPC is `SECURITY DEFINER`, which can bypass table RLS depending on function
owner and role attributes. The boundary is explicit authentication plus
authorization inside the function, not a claim that RLS still applies to every
write. The artifact uses an empty search path and schema-qualified references.

Required preflight checks before any apply:

- function owner and whether that role is superuser or `BYPASSRLS`
- helper function definitions, owners, ACLs, overloads, and search paths
- PUBLIC/anon/authenticated function execution grants and default privileges
- public-schema `CREATE` privileges
- table RLS enabled/forced state, policies, direct grants, and triggers
- function-name collisions for `save_game_team_stats` and
  `require_jsonb_nonnegative_integer`
- existing column types/defaults/nullability if period columns already exist
- historical PP/PK, totals, faceoff, season, orphan, and schedule-link violations

PUBLIC and anon execution stay revoked. Authenticated execution is the only
intended grant for the Team Stats RPC. The helper parser is internal and has no
PUBLIC/anon/authenticated execution grant.

## Phase B must not build until resolved

- OT occurrence authority and examples for regulation, OT, and unknown states
- production-data preflight result review
- legacy-write compatibility strategy for PP/PK and total constraints
- isolated PostgreSQL behavior tests for the reviewed SQL, if local disposable DB
  tooling is available
- design/security re-review of the exact commit
