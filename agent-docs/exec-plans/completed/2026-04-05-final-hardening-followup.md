# Final Hardening Follow-Up

## Goal

Land the supplied final hosted hardening follow-up patch against the current repo snapshot without disturbing unrelated dirty-tree edits.

## Scope

- Reject duplicate recipient kinds when parsing hosted user root-key envelopes.
- Prevent destructive public `putUserRootKeyEnvelope` rewrites from swapping an existing user root key.
- Keep the public full-envelope write path limited to `automation`, `user-unlock`, and `recovery`.
- Delete stale rotated root-key-envelope objects after rewriting the current one.
- Stop forwarding worker-only or unnecessary env vars into the hosted child runner.
- Add focused regression tests for those cases.

## Constraints

- Treat this as a high-risk hosted trust-boundary and secret-exposure hardening pass.
- Preserve unrelated dirty-tree edits already present in the repo.
- Port the patch intent onto the current tree rather than forcing snapshot-era hunks that no longer apply cleanly.

## Verification

- Focused tests around root-key envelope parsing/storage and runner env forwarding.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed locally; ready to close.

## Outcome

- Landed the root-key rewrite guard, duplicate-recipient rejection, public recipient-kind restriction, stale rotated-envelope cleanup, and child-runner env pruning.
- Kept `HOSTED_EMAIL_*` sender-identity env vars forwarded because the current child runtime still uses them to detect hosted email capability; pruned only worker-only values (`HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS`, `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS`).
- Focused tests and `pnpm typecheck` passed.
- `pnpm test` and `pnpm test:coverage` still fail on pre-existing hosted-web/device-sync and hosted-execution coverage issues outside this diff.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
