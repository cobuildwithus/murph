# Harden canonical nested lock ordering and simplify write-batch action application

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make canonical resource-lock ordering compositional across nested scopes and simplify the shared write-batch action protocol without changing intended write semantics.

## Success criteria

- Nested `withCanonicalResourceLocks()` calls track already-held resources for the current async scope.
- Nested acquisitions that would violate the global sorted acquisition order fail fast with a deterministic ordering error instead of timing out.
- `write-batch` action applicators share the repeated prepare/mutate/finalize protocol through common helpers, and delete no longer reuses create-oriented target preparation.
- Focused `packages/core` tests cover the nested ordering failure path and the shared write-policy behavior.
- Required scoped verification, completion audits, and the scoped commit complete, or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/core/src/operations/canonical-resource-lock.ts`
  - `packages/core/src/operations/write-batch.ts`
  - `packages/core/src/write-policy.ts`
  - directly coupled `packages/core/test/{canonical-resource-lock,operations-thresholds}.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-core-lock-order-and-write-batch-refactor.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - broader canonical write lock redesigns outside resource-order tracking
  - changes to unrelated `packages/core` mutation behavior
  - wider write-batch storage-schema changes or receipt-shape changes

## Constraints

- Technical constraints:
  - Preserve same-resource reentrancy within one canonical lock scope.
  - Keep resource ordering deterministic by canonical resource key sorting.
  - Do not weaken existing write-target policy checks or rollback behavior.
  - Work safely in the current dirty tree and avoid touching unrelated package rows.
- Product/process constraints:
  - Treat the lock change as concurrency/reliability work and capture direct proof in addition to scripted checks.
  - Follow the plan-bearing repo workflow, including the required completion audits.

## Risks and mitigations

1. Risk: Nested lock tracking could accidentally reject valid same-resource reentrancy or duplicate-resource nesting.
   Mitigation: Track the held resource set by key, allow duplicates/reentrant keys, and add focused regression coverage.
2. Risk: Shared write-batch helper extraction could change action bookkeeping or rollback assumptions.
   Mitigation: Keep action-state mutations centralized in a narrow finalize helper and preserve the existing persisted fields/effects in focused tests.
3. Risk: Delete preparation could still inherit create-side effects if the shared helpers blur operation kinds.
   Mitigation: Split target preparation by operation kind in `write-policy.ts` and route delete through the non-creating variant only.

## Tasks

1. Register the task in the active plan and coordination ledger.
2. Patch canonical resource-lock context so nested scopes track held resources and fail fast on out-of-order acquisitions.
3. Refactor write-batch action application around shared preparation/finalization helpers and split delete preparation from create/update/append preparation.
4. Add focused core tests for nested lock ordering and shared write-policy behavior.
5. Run scoped verification, direct proof, required completion audits, and the scoped commit flow.

## Decisions

- Nested canonical resource scopes will carry a sorted held-key list in async-local state and reject any new resource whose key sorts before the greatest held key not already owned by the scope.
- The write-batch applicators will share a common finalize path for action bookkeeping while leaving operation-specific mutation logic explicit.
- Delete preparation will use a dedicated verified-target helper that does not create parent directories.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/core/src/operations/canonical-resource-lock.ts packages/core/src/operations/write-batch.ts packages/core/src/write-policy.ts packages/core/test/canonical-resource-lock.test.ts packages/core/test/operations-thresholds.test.ts`
  - `pnpm test:smoke`
- Direct proof:
  - Run the focused canonical-resource-lock test that proves nested out-of-order acquisitions fail immediately with the ordering error.
- Expected outcomes:
  - `packages/core` typecheck and focused diff-aware verification pass.
  - The nested ordering regression is covered without time-based deadlock waiting.

## Current outcome

- Functional code changes are in the worktree and the required audit passes for this lane already completed: `simplify`, `coverage-write`, `task-finish-review`, plus the one allowed final-review rerun after the first review forced lock and write-resume follow-up fixes.
- The review-driven follow-ups now in the diff are:
  - same-resource canonical-lock reentry keeps per-resource held depth and only releases the underlying directory lock on the final release
  - scope-local canonical acquisitions serialize through one async-local queue before ordering checks, so sibling acquisitions cannot race the held-key snapshot
  - delete preparation uses the dedicated non-parent-creating target verifier instead of the create/update helper
  - write-batch resume handling now rejects missing overwrite targets or missing delete backups, while same-content non-overwrite resumes settle as `reuse`
- Verification/proof currently available:
  - Passed focused Vitest: `pnpm exec vitest run packages/core/test/canonical-resource-lock.test.ts -t "canonical resource lock scopes re-enter the same resource without deadlocking"`
  - Passed focused Vitest: `pnpm exec vitest run packages/core/test/operations-thresholds.test.ts -t "applyCanonicalWriteBatch resumes same-content non-overwrite writes as reuse without backup metadata|applyCanonicalWriteBatch reports resume conflicts when delete backups are missing|applyCanonicalWriteBatch reports resume conflicts when overwrite targets disappear after backup preparation|applyCanonicalWriteBatch treats deletes of missing files as no-ops without creating parent directories"`
  - Passed direct proof: `pnpm exec tsx --eval '(async () => { /* delete-missing proof */ })()'` confirmed a delete of a missing file leaves both the target and its parent directory absent
  - Passed: `pnpm test:smoke`
  - Passed: `git diff --check -- packages/core/src/operations/canonical-resource-lock.ts packages/core/src/operations/write-batch.ts packages/core/src/write-policy.ts packages/core/test/canonical-resource-lock.test.ts packages/core/test/operations-thresholds.test.ts agent-docs/exec-plans/active/2026-04-23-core-lock-order-and-write-batch-refactor.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Current unrelated blockers outside this task:
  - `pnpm typecheck` is still red on the unrelated branch-local package failure in `packages/vault-usecases` (`Cannot find module '@murphai/core'` from that package's typecheck target)
  - `bash scripts/workspace-verify.sh test:diff packages/core/src/operations/canonical-resource-lock.ts packages/core/src/operations/write-batch.ts packages/core/src/write-policy.ts packages/core/test/canonical-resource-lock.test.ts packages/core/test/operations-thresholds.test.ts` is still red on unrelated reverse-dependent `packages/assistantd` type errors (`executionDriver: "codex-cli"` and `resumeKind: "codex-session"` no longer match the current contract)
- The lane is ready for the standard `scripts/finish-task` landing flow, which can now create a scoped commit despite the broader dirty tree because the active plan and exact path list identify the intended slice.
Completed: 2026-04-23
