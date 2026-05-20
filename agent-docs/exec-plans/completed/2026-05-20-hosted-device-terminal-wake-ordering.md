# Hosted Device Terminal Wake Ordering

## Goal

Keep the hosted device-sync snapshot as the source of truth for terminal connection status during a single sync pass. A stale explicit wake reason must not mutate a freshly hydrated terminal account from `disconnected` to `reauthorization_required` or the reverse.

## Scope

- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`

## Plan

1. Move terminal-account detection in `applyHostedDeviceSyncWakeHint` before explicit terminal wake-reason mutation.
2. Dead-letter pending local jobs and return when the hydrated account is already terminal.
3. Add focused regression coverage for terminal snapshot status disagreeing with stale explicit wake reason.
4. Run focused assistant-runtime tests and repo typecheck.

## Verification

- Passed: `pnpm --filter @murphai/assistant-runtime test -- test/hosted-device-sync-runtime.test.ts`
- Passed: `git diff --check -- packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts agent-docs/exec-plans/active/2026-05-20-hosted-device-terminal-wake-ordering.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Blocked by unrelated dirty health-metrics work: `pnpm typecheck`
- Blocked by the same unrelated dirty health-metrics work during assistant-runtime typecheck: `pnpm --filter @murphai/assistant-runtime typecheck`
- Blocked by the same unrelated dirty health-metrics work during assistant-runtime typecheck: `pnpm test:diff packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
