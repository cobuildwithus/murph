# Queue canonical write lock and narrow outer mutation locking for append-style writes

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Let concurrent append-style canonical writes start and prepare in parallel without spurious `CANONICAL_WRITE_LOCKED` failures, while preserving one global commit-time lock for the current shared-shard storage model.

## Success criteria

- `acquireCanonicalWriteLock()` waits with a bounded timeout instead of failing immediately when another process currently owns the lock.
- Append/import-style public mutation entrypoints that do not require broad pre-read serialization stop taking the outer canonical lock for the whole operation.
- Explicit-id rewrite flows that still depend on pre-reading existing shards keep the broader outer lock.
- Focused regression coverage proves cross-process lock waiting and parallel meal/workout writes.
- Required repo verification, required audit passes, and a scoped commit are completed unless blocked by an unrelated pre-existing failure.

## Scope

- In scope:
- `packages/core/src/operations/canonical-write-lock.ts`
- `packages/core/src/public-mutations.ts`
- Focused `packages/core/test/**` coverage for the new concurrency behavior
- Out of scope:
- Canonical storage-model changes
- New public write APIs or broad mutation-layer refactors
- Unrelated `packages/core` scheduler or hosted-runtime work already active elsewhere

## Constraints

- Technical constraints:
- Keep the existing commit-time umbrella lock because canonical event and audit writes still share monthly append targets.
- Preserve re-entrant same-process lock behavior and current stale-lock diagnostics.
- Product/process constraints:
- Treat the downloaded ChatGPT patch as scoped intent, not overwrite authority.
- Preserve unrelated worktree edits and stay off the active scheduler lane except for the targeted files above.
- Follow the high-risk repo workflow: scoped verification, required completion audits, then `scripts/finish-task`.

## Risks and mitigations

1. Risk: Narrowing outer locks could reopen unsafe rewrite races for flows that pre-read existing shards.
   Mitigation: Only remove the outer lock from append/import-style entrypoints; keep explicit-id rewrite paths on the broad lock.
2. Risk: Waiting on the global lock could hang indefinitely or mask stale-lock failures.
   Mitigation: Use bounded retry with timeout and preserve stale/active inspection in the terminal error path.
3. Risk: Parallel-process regression coverage could be flaky.
   Mitigation: Keep the test focused, use explicit child-process coordination, and assert absence of `CANONICAL_WRITE_LOCKED`.

## Tasks

1. Compare the downloaded patch and review note against the live `packages/core` locking and mutation code.
2. Implement only the applicable lock-waiting and outer-lock narrowing changes.
3. Add or adapt focused regression coverage for cross-process waiting and parallel meal/workout writes.
4. Run required scoped verification plus direct scenario proof.
5. Run required `coverage-write` and `task-finish-review` audit passes, address findings, and finish with a scoped commit.

## Decisions

- Keep one global commit-time canonical write lock for now; do not attempt true parallel commit on the current shared monthly shard layout.
- Treat fresh workout/body-measurement writes as append-style, but keep explicit-id flows on the broad outer lock.
- Fail immediately on stale canonical-write lock inspections; only active holders should wait/retry.
- Treat the audit's timezone/day-key race note as a pre-existing behavior rather than a regression from this patch, because `updateVaultSummary()` does not participate in the old outer canonical write lock path either.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/core/src/operations/canonical-write-lock.ts packages/core/src/public-mutations.ts packages/core/test/canonical-write-lock.test.ts packages/core/test/canonical-write-lock-parallel.test.ts`
- `pnpm test:smoke`
- Expected outcomes:
- The scoped `packages/core` verification lane passes with the new tests covering cross-process lock waiting and parallel meal/workout writes.

## Current state

- Implementation complete.
- Required `coverage-write` pass landed one narrow boundary test in `packages/core/test/canonical-mutations-boundary.test.ts`.
- Required final review completed; one real regression (stale-lock wait on unrecoverable stale state) was fixed afterward.

## Verification results

- `pnpm --dir packages/core typecheck` -> passed
- `pnpm --dir packages/core test -- canonical-write-lock.test.ts canonical-write-lock-parallel.test.ts` -> passed
- `pnpm --dir packages/core test:coverage` -> passed after the coverage-write pass and again after the stale-lock follow-up; latest run: 27 files, 288 tests
- `pnpm test:smoke` -> passed
- `pnpm typecheck` -> passed before the stale-lock follow-up
- direct scenario proof -> passed: a second process waited about 996ms for the canonical write lock, and concurrent meal/workout writes both succeeded without `CANONICAL_WRITE_LOCKED`
- `pnpm test:diff ...` -> not a truthful closeout signal in the current dirty tree; it broadened into unrelated owners and failed in out-of-scope `packages/device-syncd/test/service.test.ts` (`queued` vs `dead`)
- rerun of root `pnpm typecheck` after the stale-lock follow-up is currently blocked by another active task holding the shared workspace-artifact lock through `apps/web verify`
Completed: 2026-04-15
