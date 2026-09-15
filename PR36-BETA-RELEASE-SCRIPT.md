# PR36 beta release script

1. **QUEUED:** Review the local commit list, automated tests, security review, and this checklist. Obtain explicit approval before pushing or deploying.
2. **BETA:** After an explicit approval, promote only the reviewed queued revision. Apply the approved migrations once, run `BETA-SMOKE-TEST.md`, and record results. Obtain a separate explicit approval before LIVE.
3. **LIVE:** Promote the exact beta-approved revision only after explicit LIVE approval. Verify the production migration ledger and post-release health checks.

This document is procedural only. It does not authorize a push, migration, deployment, or promotion.
