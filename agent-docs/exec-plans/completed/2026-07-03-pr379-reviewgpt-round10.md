# PR 379 ReviewGPT Round 10 Atomic Follow-Up Enqueue

## Goal

Close ReviewGPT round 10 by ensuring provider scheduled follow-up jobs are persisted atomically with owned job completion and account sync success.

## Constraints

- Reuse the existing SQLite job table, dedupe behavior, and account sync-state primitives.
- Do not add a retry manager, extra scheduler, or alternate state source.
- Preserve the current worker lease/account-current guards.

## Plan

1. Extract in-transaction variants of the existing owned-job completion and sync-success helpers.
2. Add a store method that completes owned jobs, marks sync success, and enqueues scheduled follow-up jobs in one immediate transaction.
3. Use that method from `runWorkerOnce` after provider execution.
4. Add a service regression that proves a failure during follow-up enqueue rolls back job completion/account success.
5. Run focused tests, typecheck, diff verification, commit, push, and rerun ReviewGPT.

## Verification

- `pnpm --dir packages/device-syncd test -- service.test.ts`
- `git diff --check`
- `pnpm typecheck`
- `pnpm test:diff packages/device-syncd/src/service.ts packages/device-syncd/src/store.ts packages/device-syncd/src/store/jobs.ts packages/device-syncd/src/store/sync-state.ts packages/device-syncd/test/service.test.ts`
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
