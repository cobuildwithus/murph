Goal (incl. success criteria):
- Add a real canonical single-writer lock for core writes so cross-process commits cannot interleave on the same vault.
- Surface stale canonical lock issues through the public validation path without editing files currently owned by other active lanes.
- Keep the change inside unowned seams and cover it with an integration-style test.

Constraints/Assumptions:
- Do not touch files already owned by active ledger rows, especially `packages/core/src/vault.ts`, `packages/core/test/**`, `packages/core/src/profile/storage.ts`, `packages/core/src/assessment/storage.ts`, and `packages/core/src/bank/**`.
- Work on top of the existing dirty tree without reverting unrelated edits.
- Prefer the root package export surface plus shared operations helpers over invasive changes inside owned modules.

Key decisions:
- Put the canonical lock primitive under `packages/core/src/operations/` using an atomic lock directory under `.runtime/locks/canonical-write`.
- Enforce the lock centrally inside `WriteBatch.commit()` for all batch-backed writes and wrap root-package mutator exports for direct-write entrypoints.
- Route stale-lock validation through a new public wrapper export rather than modifying `packages/core/src/vault.ts` directly.

State:
- completed

Done:
- Read repo guidance, verification docs, and active ownership constraints.
- Confirmed `packages/core/src/vault.ts` and `packages/core/test/**` are currently owned by another active lane.
- Mapped exported core write entrypoints and confirmed the root package index is an unowned seam.
- Added `acquireCanonicalWriteLock()` plus stale-lock inspection under `packages/core/src/operations/`.
- Wrapped the root `packages/core` mutator exports and validation path in a lock-aware public module.
- Added `WriteBatch.commit()` and `WriteBatch.rollback()` locking so direct batch users also coordinate on canonical writes.
- Added `packages/cli/test/canonical-write-lock.test.ts` and registered it in `vitest.config.ts`.
- Verified `pnpm --dir packages/core typecheck`, `pnpm --dir packages/cli typecheck`, `pnpm build`, `pnpm exec vitest run packages/cli/test/canonical-write-lock.test.ts --no-coverage --maxWorkers 1`, and `pnpm test:smoke` all passed.
- Verified repo-wide `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` still fail on pre-existing active-lane issues in `packages/cli/src/commands/samples-audit-read-helpers.ts` and `packages/cli/src/inbox-services.ts`.

Now:
- None.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether any downstream code imports mutators directly from submodules instead of the root package surface; `WriteBatch.commit()` will still protect batch-backed flows in that case.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-canonical-write-lock.md`
- `packages/core/src/index.ts`
- `packages/core/src/operations/index.ts`
- `packages/core/src/operations/write-batch.ts`
- `packages/core/src/operations/canonical-write-lock.ts`
- `packages/core/src/public-mutations.ts`
- `packages/cli/test/canonical-write-lock.test.ts`
- `vitest.config.ts`
- Commands: `pnpm typecheck`, `pnpm test:packages`, `pnpm test:smoke`, `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
