# Assistant Input Cursor Ordering

## Goal

Fix assistant input cursor pagination so distinct inputs at the same instant are
never skipped, and collapse duplicated timestamp comparator logic onto the
contracts owner without adding new package edges.

## Constraints

- Keep the existing assistant/core comparator API names where callers already
  use them.
- Preserve instant-first timestamp ordering semantics.
- Avoid broad refactors or compatibility scaffolding.
- Do not touch unrelated active work.

## State

Completed.

## Plan

1. Route assistant/core/hosted timestamp comparison through
   `@murphai/contracts`.
2. Let assistant input cursor ordering fall through to source/input tie-breakers
   when timestamp instants compare equal, using each cursor's own stable
   timestamp key (`createdAt ?? occurredAt`).
3. Add production-faithful `limit: 1` pagination regressions for equal
   instants with different timestamp encodings.
4. Add a mixed nullable/non-null `createdAt` regression that drains pages until
   empty and proves no input repeats or disappears.
5. Run focused verification and finish with a scoped commit/PR.

## Verification

- `git diff --check`
- `pnpm exec vitest run --config vitest.config.ts test/assistant-input-store.test.ts`
  from `packages/assistant-engine`
- `pnpm typecheck`
- `pnpm --dir packages/assistant-runtime build`
- `pnpm --dir packages/hosted-local-harness test`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/input-store.ts packages/assistant-engine/src/assistant/shared.ts packages/assistant-engine/test/assistant-input-store.test.ts packages/assistant-runtime/src/hosted-runtime/callbacks.ts packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts packages/assistant-runtime/src/hosted-runtime/timestamp-order.ts packages/core/src/time.ts`
- `pnpm test:smoke`
- ReviewGPT PR review on PR 281 found a mixed-null cursor transitivity issue;
  fixed in this plan and re-verified with the focused assistant input-store test.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
