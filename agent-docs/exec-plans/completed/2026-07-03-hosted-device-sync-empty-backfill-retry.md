Goal (incl. success criteria):
- Let hosted runtime publish an earlier non-null `nextReconcileAt` when the local device-sync owner changes it for an empty-backfill retry.
- Success means the hosted apply stores the earlier retry wake, later hydration keeps it from being overwritten by the old web baseline, and the scheduler sees the account due at T+15.

Constraints/Assumptions:
- Scope is `packages/assistant-runtime` and `packages/device-syncd`.
- Preserve the hosted apply/version fence that prevents stale runtime state from regressing hosted device-sync facts.
- Keep the fix at the hosted runtime seam; do not add a scheduler, queue, or second state owner.
- Do not run commit helpers, `git commit`, or `git push`; supervisor commits after review.

Key decisions:
- Keep wake hints forward-only; only owner-authored local account `nextReconcileAt` publish is allowed to move earlier.
- Rely on the existing web apply `observedUpdatedAt`/version fence for stale runtime writes.

State:
- Implementation done; awaiting supervisor review and commit.

Done:
- Inspected `assignNextReconcileAtUpdate`, call sites, current tests, and git history for the monotonic guard.
- Removed the forward-only guard for changed non-null owner values while preserving terminal-status null clearing.
- Added hosted round-trip regression coverage for empty-backfill retry publish, hydration, and T+15 scheduling.
- Ran focused and package verification; full package suites are blocked by sandbox TCP bind restrictions where noted.

Now:
- No active coding. Supervisor review/commit is pending.

Next:
- Supervisor commits or requests follow-up changes.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `packages/device-syncd/**`
- `pnpm --dir=packages/device-syncd typecheck && pnpm --dir=packages/device-syncd test && pnpm --dir=packages/assistant-runtime typecheck && pnpm --dir=packages/assistant-runtime test`
- `pnpm --dir=packages/assistant-runtime typecheck`
- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-device-sync-runtime.test.ts`
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
