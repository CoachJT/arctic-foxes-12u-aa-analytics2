# Game Center + Stats 2.0 — Frontend Specification (single source of truth)

Status: APPROVED SCOPE — this document is the canonical, binding specification
for all Game Center 2.0 / Stats 2.0 / Analytics frontend work. It exists so
that the three parallel implementation sessions (Game Center UI, Stats filter
engine, Analytics UI) build against **one shared contract** instead of each
inventing its own schema, formulas, routes, or filtering semantics.

**Rule for every child session:** if something you need is not specified
here, or the existing codebase conflicts with this spec, STOP and report it
back to the parent integration session instead of deciding unilaterally.
Do not invent an alternate filter algorithm, an alternate stat formula, an
alternate navigation route, or an alternate schema/RPC. Integration and
conflict resolution happen in the parent session, not in child branches.

All child branches are based on, and must open their PR/diff against,
`feature/game-center-stats-2-integration` (this branch) — never against each
other, and never against `main`.

## 1. Backend contract (already implemented, reviewed, proven — do not modify)

- RPC: `public.save_game_team_stats(target_team_id uuid, target_season_id uuid,
  target_source_game_id text, payload jsonb)`.
- Full behavior: `docs/game-center-stats-phase-b-contract.md`.
- Migration: `supabase/migrations/20260916090000_game_center_stats_phase_a_team_stats_contract.sql`.
- Real-PostgreSQL proof: `tests/game-center-stats-phase-a-postgres.test.cjs`
  (16/16 passing). JS-model proof: `tests/game-center-stats-phase-a.test.cjs`
  (14/14 passing).
- NULL vs explicit zero, patch-vs-snapshot payload rules, accepted/rejected
  keys, and total-shot derivation are defined there — read it before writing
  any frontend save logic.
- **No authoritative OT-occurrence field exists.** Do not infer OT from tied
  score, notes, or optional shot entries, and do not invent a second
  OT-occurrence source of truth in the frontend. Treat this as an open design
  gap; UI must degrade safely (e.g., OT inputs are optional/raw, never drive
  a fabricated "OT occurred" signal).
- `save_game_team_stats` never writes score, period-goal, player/goalie, or
  season-record-rollup fields (proven). Score display in any new UI must be
  **read-only**, sourced from existing score data/RPCs
  (`save_game_score` / `save_game_stats`), never written through the new RPC.

## 2. NULL vs. sample-size semantics (binding for ALL tabs)

- `0` = a recorded zero. Display as `0`.
- Missing/unrecorded = display as `—` (or literal "Not Recorded"), and
  **exclude that game from the denominator** for any per-game-average stat.
- Example (binding, must be provable in code and tests): 10 selected games,
  4 of which have a recorded value for a given field → the average for that
  field is `sum(recorded) / 4`, never `/ 10`.
- This applies uniformly to every stat surfaced anywhere in Stats 2.0 /
  Analytics — there is exactly one implementation of this rule (see §3), not
  one per tab.

## 3. Stats 2.0 global filter engine (single authoritative selected game set)

There must be exactly **one** shared module/selector that computes the
"currently selected game set" and its derived aggregates. Every Analytics tab
and every Stats view reads from this one selector — no tab computes its own
filtered game list or its own aggregate formulas independently.

### 3.1 Filter modes (exactly these, no additions without parent approval)

- **Single Game** — exactly one game, selected explicitly (e.g. via
  Stats-game → Game Center navigation context, or a direct picker).
- **Last 5 / Last 10 / Last 20** — the N most recent games for the active
  team+season by game date descending (ties broken by a stable existing game
  ordering key already used elsewhere in the app — discover and reuse it,
  do not invent a new tiebreak rule). If fewer than N games exist, use all
  available games and the UI must indicate the actual count used (e.g.
  "Last 10 (7 available)"), never silently pad or fabricate data.
- **All Season** — every game in the active season for the active team.
- **Custom** — an explicit date range (inclusive) within the active season.
- **Game Type** — filters the current game set (whichever base mode is
  active) to games matching a selected game-type value(s) that already
  exists in the schema (e.g. regular/season type field already on
  `team_games` or linked schedule data). Discover the real column/values;
  do not invent new game-type taxonomy.
- **Opponent** — filters the current game set to games against a selected
  opponent (or set of opponents), using the existing opponent field already
  present on games.
- Game Type and Opponent are **modifiers** layered on top of a base range
  mode (Last N / All Season / Custom), not standalone replacements — i.e. a
  user can select "Last 20" + "Opponent = X" to mean "the most recent 20
  games, filtered further to that opponent." Confirm this composition
  approach is feasible given the real data model; if not, report back rather
  than redefining it independently.

### 3.2 Active filter context

- The selected filter (mode + params + resulting game ID list) must live in
  one shared state object ("active filter context"), readable by Game
  Center, Stats, and Analytics, and it must be the single source every
  chart/card/table reads from. No independent duplicate fetching of "the
  selected games" per card.
- Changing the filter must deterministically recompute the same shared game
  set for every consumer in the same render pass (no stale/mismatched game
  sets between cards).

## 4. Navigation (must reuse existing app router/state conventions)

Required connections, using whatever the existing app's actual navigation
mechanism is (discover it in `web/app.js` — do not invent a parallel routing
system):

- Stats game (a row/card representing one game) → Game Center for that game.
- Player (in Stats/Analytics) → Player Profile view.
- Command Center action → Team Stats (Game Center tab) for the relevant
  game/context.
- Game Center Film tab → game-scoped Film view (the existing Film Room
  filtered/scoped to that one game).

If the existing architecture cannot safely support one of these links (e.g.
no game-scoped Film entry point exists yet), the responsible session must
report that explicitly as a gap — do not fake the navigation or silently
drop the requirement.

## 5. Stats 2.0 navigation rename

The existing "Stats" navigation entry is renamed/restructured per the
approved product ask into: global filter bar + tabs for **Overview, Trends,
Special Teams, Periods, Players, Goalies, Games**. The exact rename label(s)
must match existing app naming conventions found in `web/app.js` /
`web/index.html` — discover and reuse the existing terminology style rather
than inventing new labels.

## 6. Ownership split (avoid file/branch conflicts)

- **Session A — Game Center 2.0 UI**: Game Center tabs (Overview, Team
  Stats, Players, Goalies, Film) and the `save_game_team_stats` UI/save
  integration, including mobile behavior at existing supported breakpoints.
- **Session B — Stats 2.0 filter engine**: the shared filter/selector module
  (§3), the active filter context (§3.2), the Stats navigation rename (§5),
  and the navigation wiring in §4 that depends on the filter context. Session
  B owns the one shared calculation/selector module referenced by §2 and §3.
- **Session C — Analytics UI**: the seven Analytics tabs (Overview, Trends,
  Special Teams, Periods, Players, Goalies, Games), all of which must consume
  Session B's shared selector/filter context and Session B's shared
  calculation helpers — Session C must NOT write its own parallel
  aggregation logic. If Session B's module is not ready/merged yet, build
  against a clearly-marked stub/interface and flag the dependency to the
  parent rather than duplicating the logic.

Each session works on its own branch and opens results back against
`feature/game-center-stats-2-integration`. The parent session performs all
integration, conflict resolution, full test-suite runs, and browser/visual
QA after each merge.

## 7. Hard guardrails (apply to every child session)

- No remote Supabase access, no remote SQL execution, no migration apply, no
  Edge Function deploy, no service-role credential use.
- No merge to `main`. No push unless explicitly instructed later by the
  parent/user.
- Do not claim a screenshot, navigation link, or responsive behavior works
  unless it was actually rendered/verified; state plainly if it could not be
  verified.
- Do not modify the Phase A migration or its two existing proof test files
  unless a genuine bug is found and proven — report to parent first.
