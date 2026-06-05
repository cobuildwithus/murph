# Device Sync Dirty Ack Requeue

## Goal

Make remaining hosted device-sync dirty work requeue device-sync directly at the
dirty-ack boundary instead of depending on assistant workspace wake metadata.

## Constraints

- Keep Cloudflare and the hosted/local runtime as thin runners.
- Do not change generic wake priority or add scheduler state.
- Preserve foreground assistant preemption over background device-sync work.
- Keep provider payloads, secrets, and direct identifiers out of logs/tests.

## Plan

1. Add the existing hosted device-sync maintenance signal at the web dirty-ack
   boundary when pending dirty work remains.
2. Fail the dirty-ack response if that signal fails or hangs so the existing
   mailbox retry path retries the ack boundary; keep `nextWakeAt` only as
   compatibility data after a successful ack.
3. Pass remaining staged dirty-ack batch records through the existing staged
   overlay so early records in the same batch do not require redundant recovery
   signals before the batch finishes.
4. Add focused regressions proving dirty-ack requeue and foreground preemption
   expectations.
5. Run focused verification, completion audits, then archive this plan in the
   final scoped commit.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-hosted-runtime-authority.test.ts`
  passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts -t "keeps background recovery device-sync deferred when foreground input is fresh"`
  passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts -t "dirty"`
  passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/device-syncd/test/hosted-runtime.test.ts`
  passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/runner-platform.test.ts -t "device-sync dirty"`
  passed.
- `pnpm test:diff` passed.
- `pnpm typecheck` passed.
- Security/privacy audit: no medium-or-higher findings.
- Task-finish audit: no findings; noted split coverage is reasonable.
- Runtime deep audit: accepted batch-staging finding; fixed by passing remaining
  batch records as `stagedDirtyAcks` through the existing dirty-ack protocol.
- Focused audit reruns after the staged batch fix: security/privacy no
  medium-or-higher findings, runtime/idempotency no findings, task-finish no
  findings.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
