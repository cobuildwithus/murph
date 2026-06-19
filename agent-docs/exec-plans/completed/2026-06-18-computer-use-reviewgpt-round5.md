# Computer-Use ReviewGPT Round 5 Fixes

## Goal

Resolve the three accepted ReviewGPT High findings on PR 214:

1. Set Kernel browser idle timeout to the durable computer-run TTL.
2. Require pause/checkpoint delivery context to match before refreshing an awaiting handoff.
3. Reserve the active computer run row before creating a save-backed Kernel browser, removing the concurrent loser browser branch.

## Constraints

- Keep browser-control architecture minimal: no broad authorization framework or new workflow service.
- Preserve durable pause/resume semantics and retryable terminal browser cleanup.
- Avoid Kernel calls inside interactive DB transactions.
- Keep persisted browser URL state sanitized and terminal state scrubbed.

## Working Set

- `apps/web/src/lib/computer-use/kernel-client.ts`
- `apps/web/src/lib/computer-use/service.ts`
- `apps/web/src/lib/computer-use/store.ts`
- `apps/web/test/hosted-execution-computer-use.test.ts`
- `apps/web/test/hosted-retention-cleanup.test.ts`

## Verification Plan

- Focused computer-use Vitest.
- `apps/web` typecheck.
- `git diff --check` and privacy diff scan.
- Push and rerun the PR ReviewGPT loop.

## Current State

- ReviewGPT round 5 found three High issues after commit `0aa3e4c90`.
- Findings accepted after code inspection.
- Implemented:
  - Kernel browser creation receives the computer-run TTL as the browser idle timeout.
  - Refreshed awaiting handoffs require the original checkpoint delivery context.
  - Run creation reserves a browserless active row before Kernel provisioning; browser attachment is a separate guarded transition.

## Verification Notes

- PASS `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/hosted-account-data-service.test.ts`
- PASS `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-computer-use.test.ts apps/web/test/hosted-account-data-service.test.ts apps/web/test/hosted-retention-cleanup.test.ts`
- PASS `pnpm --dir apps/web typecheck`
- PASS `git diff --check`
- PASS privacy diff scan
- PASS `pnpm test:diff` (Next build emitted an existing Turbopack NFT warning)
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
