## Title

Add the web/shared hosted-run release-finalize seam so retryable finalize failures can immediately return to resumable recovery.

## Goal

Add the missing hosted-run release-finalize request/response contract, parser, web route, and store logic so a retryable finalize failure can move `finalizing -> committed_needs_finalize` without waiting for stale-run recovery, while still fencing the transition on the active run token and `finalizing` status.

## Scope

- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/src/parsers.ts`
- `packages/hosted-execution/src/parsers/run-control.ts`
- `apps/web/src/lib/hosted-run/store.ts`
- `apps/web/app/api/internal/hosted-run/release-finalize/route.ts`
- focused `apps/web/test/hosted-run-store.test.ts` only if direct proof is needed

## Constraints

- Keep the write scope out of `apps/cloudflare/**`; that lane is owned elsewhere.
- Preserve unrelated dirty-tree edits and overlapping hosted-run work in progress.
- Do not broaden into schema changes or unrelated hosted-run lifecycle rewrites.
- Keep release behavior fenced by `runId`, `runToken`, and `status = finalizing`.

## Verification

- planned: `pnpm typecheck`
- planned: `pnpm test:diff packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/src/parsers/run-control.ts apps/web/src/lib/hosted-run/store.ts apps/web/app/api/internal/hosted-run/release-finalize/route.ts apps/web/test/hosted-run-store.test.ts`
- planned: `git diff --check`

## Notes

- `finalizeHostedRunTx` already fails closed on token/status mismatches; the release path should mirror that fence and only hand the run back to `committed_needs_finalize`.
- Stale finalize recovery already resets `finalizing -> committed_needs_finalize`; this task adds the explicit retry-release path so the executor does not need to wait for staleness to recover.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
