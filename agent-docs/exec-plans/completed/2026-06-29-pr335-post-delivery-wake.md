# PR 335 Post-Delivery Wake

## Goal

Fix the scheduled-reminder CI failure by ensuring hosted post-delivery state clears consumed delivery wakes and pending delivery status after a send.

## Constraints

- Keep the fix in the hosted runtime owner of wake/status projection.
- Do not add Cloudflare/test-harness retries, new schedulers, or new queues.
- Preserve future wakes and current cron/outbox/system/provider wake owners.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`

## Verification

- Focused assistant-runtime tests for post-delivery wake/status reconciliation.
- Local scheduled-reminder hosted E2E if feasible.
- Repo-required typecheck/docs/diff checks.
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
