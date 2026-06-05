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
3. Add focused regressions proving dirty-ack requeue and foreground preemption
   expectations.
4. Run focused verification, completion audits, then archive this plan in the
   final scoped commit.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-hosted-runtime-authority.test.ts`
  passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts -t "keeps background recovery device-sync deferred when foreground input is fresh"`
  passed.
- `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts -t "dirty"`
  passed.
- `pnpm test:diff` passed.
- `pnpm typecheck` passed.
- Completion audit subagents pending.
