# 2026-03-17 Core id-or-slug dedupe

## Goal

Centralize the duplicated low-level id-or-slug lookup work used by health-bank and markdown-registry selectors while preserving existing conflict and missing behavior exactly.

## Scope

- `packages/core/src/bank/shared.ts`
- `packages/core/src/registry/markdown.ts`
- one new internal helper module under `packages/core/src/registry/`
- targeted `packages/core/test/*` updates only if needed to prove behavior

## Constraints

- Preserve existing conflict detection on upsert paths.
- Preserve existing missing errors on read paths.
- Keep all error codes and messages byte-for-byte stable.
- Do not force regimen `group` semantics into the shared helper unless the extension stays obviously tiny.

## Plan

1. Extract one internal helper that resolves `byId`, `bySlug`, optional mismatch state, and the preferred `match`.
2. Rebuild the existing bank and markdown-registry wrappers on top of that helper without changing their public behavior.
3. Run targeted core tests, required verification, completion-workflow audits, then commit only the scoped files.

## Outcome

- Added one internal matcher in `packages/core/src/registry/id-or-slug.ts`.
- Rebuilt the bank and markdown-registry wrappers on top of it without changing their conflict or missing surfaces.
- Left regimen selectors unchanged because their `group`-aware slug semantics are still a distinct case.

## Verification

- `pnpm --dir packages/core typecheck` ✅
- `pnpm --dir packages/core test` ✅
- `pnpm typecheck` ❌ unrelated pre-existing failures in `packages/contracts` script typecheck/import resolution after the contracts build and later in `packages/cli/src/usecases/integrated-services.ts`
- `pnpm test:packages` ❌ unrelated pre-existing `packages/cli/src/usecases/integrated-services.ts` build errors
- `pnpm test:smoke` ✅
- `pnpm test` ❌ blocked by the same unrelated `packages/cli/src/usecases/integrated-services.ts` build errors
- `pnpm test:coverage` ❌ blocked by the same unrelated `packages/cli/src/usecases/integrated-services.ts` build errors

Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
