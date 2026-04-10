## Goal

Finish the assistant event/deadline scheduler cutover so hosted and local automation both follow the same rule: ready work drains until idle, and blocked work returns a real wake deadline.

## Constraints

- Keep scope to the scheduler, hosted maintenance, and assistant automation retry/wake surfaces.
- Preserve unrelated in-flight iMessage removal work already present in the tree.
- Avoid reintroducing synthetic polling wakes when immediate follow-up work can be handled by another pass.

## Files In Scope

- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-engine/src/assistant/**`
- `apps/cloudflare/src/user-runner/**`
- `packages/device-syncd/src/service.ts`
- Focused tests under the matching package/app test directories

## Plan

1. Make hosted maintenance drain repeatedly until idle, with progress-aware assistant/device-sync/parser pass handling and no hosted-only fake `+1s` wake shims.
2. Persist auto-reply retry deadlines on failed turn receipts and make startup recovery honor them instead of retrying early.
3. Convert document-preservation failures into deferred wake results so local automation does not sleep indefinitely.
4. Clamp overdue hosted preferred wakes to immediate scheduling instead of dropping them.
5. Add focused regression tests for each edge and run scoped verification.

## Verification Target

- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine/src/assistant packages/assistant-runtime/src/hosted-runtime apps/cloudflare/src/user-runner packages/device-syncd/src/service.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts packages/assistant-engine/test/assistant-automation-wake.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts apps/cloudflare/test/runner-queue-state.test.ts packages/device-syncd/test/service.test.ts`

## Status

- Implemented hosted drain-until-idle maintenance passes, overdue hosted wake clamping, persisted auto-reply retry deadlines, startup-recovery deadline gating, and document-preservation retry deadlines.
- Focused verification passed:
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/assistant-engine test -- test/assistant-automation-runtime.test.ts test/assistant-automation-wake.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/device-syncd test -- test/service.test.ts`
  - `pnpm --dir apps/cloudflare test:node -- test/runner-queue-state.test.ts`
- Repo-level verification is currently blocked by unrelated in-flight tree issues:
  - `pnpm typecheck` fails in workspace verification because `packages/inboxd-imessage/package.json` is missing from other concurrent work.
  - `pnpm test:diff ...` was blocked by the workspace verify lock held by another concurrent diff run in the same worktree.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
