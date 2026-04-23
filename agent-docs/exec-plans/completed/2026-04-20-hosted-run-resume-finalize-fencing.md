## Title

Fence resumable hosted-run finalize acquisition so overlapping acquires cannot stomp the finalize token.

## Goal

Make resumable finalize recovery single-owner: acquiring a resumable finalize run must atomically claim it by transitioning `committed_needs_finalize` to `finalizing` with a fresh token, and stale `finalizing` runs must fall back to `committed_needs_finalize` instead of becoming unrecoverable failures.

## Scope

- `apps/web/src/lib/hosted-run/store.ts`
- focused `apps/web` tests covering resumable finalize acquisition and stale finalizing recovery
- directly coupled shared hosted-run status contract/parsers if the new `finalizing` state needs to surface across app boundaries

## Constraints

- Keep this as a narrow hosted-run recovery/fencing fix only.
- Preserve unrelated dirty-tree edits and overlapping hosted-run / hosted-wake lanes.
- Do not broaden into schema changes; `HostedRun.status` is already string-backed.
- Preserve the greenfield recovery invariant: stale finalize work must remain resumable, not terminal.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-run/store.ts apps/web/test/hosted-run-store.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/test/hosted-execution.test.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts packages/hosted-execution/test/hosted-run-drain-parsers-coverage.test.ts`
- planned: `git diff --check`

## Notes

- Today `acquireHostedRunTx` can resume a finalize run by rewriting `runTokenHash` while leaving the row in `committed_needs_finalize`, which allows a later overlapping acquire to invalidate the first executor's token.
- `finalizeHostedRunTx` still accepts `committed_needs_finalize`, so stale finalize recovery must fence on status as well as token rotation.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
