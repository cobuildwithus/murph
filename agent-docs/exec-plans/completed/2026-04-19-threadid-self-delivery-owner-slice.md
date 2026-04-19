## Title

Hard-cut `sourceThreadId` to `threadId` in the shared automation and self-delivery owner slice.

## Goal

Make `threadId` the only canonical thread-routing field within the allowed shared-owner seam now that no legacy persisted data must be preserved.

## Scope

- `packages/contracts/**`
- `packages/core/**`
- `packages/query/**`
- `packages/operator-config/src/operator-config/self-delivery-targets.ts`
- direct seam tests under `packages/operator-config/test/**` that cover self-delivery thread-routing behavior

## Constraints

- Do not edit `packages/assistant-engine/**`, `packages/assistant-cli/**`, `packages/assistantd/**`, `packages/cli/**`, `packages/setup-cli/**`, `apps/**`, or unrelated `packages/operator-config/**` files.
- Remove local compatibility readers for `sourceThreadId` inside this slice unless a blocker appears within the owned code.
- Preserve unrelated dirty-tree edits already present in the touched packages.

## Verification

- `pnpm typecheck`
- truthful narrow tests for `packages/contracts`, `packages/core`, `packages/query`, and `packages/operator-config` covering the touched seam

## Notes

- Out-of-scope callers already have some `threadId` expectations; this slice should hard-cut its local schemas/types/parsers/normalizers/tests and leave external caller integration to the parent lane.

Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
