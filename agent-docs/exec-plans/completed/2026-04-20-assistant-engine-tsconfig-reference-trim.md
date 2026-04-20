## Goal

Trim stale `packages/assistant-engine/tsconfig.json` project references so they match the current direct `src/**` workspace imports, then add a package-local guard that fails if tsconfig references drift wider than the real source dependency set without an explicit allowlist entry.

## Scope

- `packages/assistant-engine/tsconfig.json`
- `packages/assistant-engine/test/assistant-tsconfig-references.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Keep the change scoped to `assistant-engine`; do not edit the in-flight workspace-boundary verifier surfaces under `scripts/**`.
- Remove only references that are unused by current `packages/assistant-engine/src/**/*.ts` imports.
- The new guard must allow explicit reference-only exceptions for dynamic or packaging-only edges instead of hard-coding hidden drift.
- Preserve unrelated dirty-tree edits, especially the existing `packages/assistant-engine/src/**` refactor work already in progress.

## Verification

- `pnpm --dir packages/assistant-engine typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/tsconfig.json packages/assistant-engine/test/assistant-tsconfig-references.test.ts`
- `pnpm --dir packages/assistant-engine test:coverage` if the diff-aware lane does not provide truthful coverage for the touched owner
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
