# Canonical Resource-Lock Write Runtime

## Goal

Replace the current commit-only canonical write lock with a resource-scoped mutation runtime that acquires locks before reads, allows safe parallel non-conflicting writes, and fixes the lost-update bug in concurrent `memory upsert` flows.

## Scope

- `packages/runtime-state/**`
- `packages/core/**`
- `packages/assistant-engine/src/knowledge/**`
- `packages/cli/src/commands/{memory,knowledge}.ts`
- targeted tests under `packages/runtime-state/test/**`, `packages/core/test/**`, `packages/assistant-engine/test/**`, `packages/cli/test/**`
- `ARCHITECTURE.md`
- `docs/contracts/03-command-surface.md`
- coordination/plan artifacts for this lane

## Constraints

- Preserve canonical vault files as the source of truth; do not introduce a new canonical database.
- Keep unrelated dirty-tree edits intact and avoid widening the change into hosted or assistant runtime surfaces that do not consume canonical mutations.
- Prefer one durable mutation abstraction over parallel safe/unsafe write APIs.
- Keep failure behavior explicit and fail closed when post-write verification disagrees with the intended mutation.

## Working Hypotheses

1. The simplest durable concurrency model for this repo is resource-scoped pessimistic locking acquired before reads, not optimistic compare-and-retry over arbitrary file reads.
2. Singleton current-state documents like `bank/memory.md` should serialize on one file resource; safe parallelism comes from disjoint resources, not same-file merging.
3. Derived shared artifacts such as the knowledge index/log should move out of the primary page write critical path or into one explicitly locked multi-resource mutation.

## Progress

- Added a new canonical resource-lock runtime in `packages/core/src/operations/canonical-resource-lock.ts`, exposed through the core operations/index public surface, and taught `WriteBatch.commit()` / `rollback()` to skip the old global lock when a resource-lock scope is already active.
- Migrated `memory`, `preferences`, `updateVaultSummary`, `appendJsonlRecord`, `applyCanonicalWriteBatch`, and selected exact-path public mutation wrappers onto resource-scoped pre-read locking.
- Wrapped knowledge page upsert and knowledge index rebuild in explicit resource bundles so the current page/index/log flow remains correct under concurrent calls while those shared artifacts stay hot-path writes.
- Added regression coverage for resource-lock contention/re-entry, concurrent memory upserts, fail-closed memory read-back verification, concurrent knowledge upserts, and parallel singleton preference updates.

## Verification

- Passed: `pnpm --dir packages/core typecheck`
- Passed: `pnpm --dir packages/core test -- canonical-resource-lock.test.ts memory.test.ts preferences.test.ts canonical-mutations-boundary.test.ts core.test.ts`
- Passed: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `pnpm --dir packages/assistant-engine test -- knowledge-service.test.ts`
- Passed: `pnpm test:smoke`
- Failed, pre-existing/unrelated: `pnpm typecheck`
  - blocker: `packages/vault-usecases/src/usecases/explicit-health-family-services.ts` TS2345 (`ListEntity` not assignable to `JsonObject`)
- Failed, same pre-existing blocker fan-out: `bash scripts/workspace-verify.sh test:diff ...`
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
