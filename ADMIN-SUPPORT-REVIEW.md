# Team support release

Founder access was enabled for the user-selected Gunton account through the existing platform_admins table. No role-management API or email-based authorization was added.

Platform Admin is reachable from the team header and remains restricted to server-resolved platform administrators. Team details include setup flags and Open support view. Inspection includes season selection, active roster, recent game scores/stat completeness and submitted reports. This is read-only inspection, not impersonation or remote control. It does not capture browser errors or prove why a user failed a workflow. Existing staff invite and beta controls remain available to existing platform-admin permissions.

The approved additive migration creates a private, RLS-enabled audit log and a private authorization-checked function behind a public invoker wrapper. No existing policies or team records were changed. Film and private coaching notes are excluded. Anonymous execution and direct audit-log access are revoked. Limits: 200 season games, 500 active roster rows, latest 50 reports. Inspection reads and log append occur together.

Validation: 402 automated tests passed. Verified all three live team snapshots in rolled-back transactions; verified non-admin and missing-identity denial, foreign-season denial and audit-log insertion. Checked desktop and 390px preview, safe HTML rendering, unavailable-state handling, rapid team navigation and stale request rejection. Syntax and whitespace checks passed. Database migration version is 20260916015319, taken from the server ledger; CLI download failed certificate validation so the exact applied migration was saved locally from that ledger.

Security advisor review: new audit table intentionally has no client policies or grants (deny all); advisor reports this as informational. Existing unrelated function and authentication advisories were not changed. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .

Rollback: restore the prior web files at f9061ee. The additive support function and access log may remain; do not remove audit history. Founder provisioning is separate and must not be revoked as part of a UI rollback without the owner's instruction.
