# PR36 migration reconciliation

This queued-only candidate is forward-only. Production is immutable through `20260915040421_028_onboarding_first_game_handoff`.

| Migration | Purpose |
|---|---|
| `20260915040422_029_team_access_codes_and_join_requests.sql` | Final deterministic global access-code enforcement and join-request hardening. |
| `20260915040423_030_platform_beta_usage_tracker.sql` | Final beta usage tracker with deduplicated aggregation. |
| `20260915040424_031_private_team_film_clips_playlists.sql` | Final private film boundary, team clip isolation, and selected active staff sharing. |

The former six draft/reconciliation migrations were consolidated before first production application, so every final object is created once. No migration in this candidate has been applied. Promotion remains `QUEUED -> BETA -> LIVE`; every promotion requires explicit approval and a verified migration ledger before execution.
