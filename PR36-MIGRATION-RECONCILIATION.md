# PR36 migration reconciliation

This queued-only candidate is forward-only. Existing migrations through `031` remain immutable.

| Migration | Purpose |
|---|---|
| `032_team_access_codes_and_join_requests` | Deterministic globally unique access-code enforcement and join-request hardening. |
| `033_platform_beta_usage_tracker` | Forward-only reconciliation of the beta usage tracker contract. |
| `034_private_team_film_clips_playlists` | Private film boundaries, team clip isolation, and selected active staff sharing. |

No migration in this candidate has been applied. Promotion remains `QUEUED -> BETA -> LIVE`; every promotion requires explicit approval and a verified migration ledger before execution.
