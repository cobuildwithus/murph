# PR 517 ReviewGPT Round 1 Fixes

## Goal

Resolve the two accepted ReviewGPT round 1 findings on PR 517 with the
smallest maintainable lifecycle primitives:

1. A successful provider revocation must always complete the matching local
   disconnect even if scheduler or worker observation state changes while the
   external call is in flight.
2. Public connection callbacks must reject invalid input before provider-wide
   admission, and provider lifecycle admission must have fixed capacity and a
   bounded wait.

## Constraints

- Keep the existing single service owner for provider connection mutations.
- Preserve serialized disconnect/reconnect ordering and idempotent disconnects.
- Preserve durable `disconnectGeneration` fencing for workers.
- Do not add a durable queue, schema change, scheduler, or broad lifecycle
  abstraction.
- Do not consume a valid one-time OAuth state when admission is rejected.

## Working Set

- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/src/store.ts`
- `packages/device-syncd/src/store/accounts.ts`
- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/test/service.test.ts`

## Verification Plan

- Focused service regressions for scheduler mutation during revoke and bounded
  callback admission.
- Full `packages/device-syncd` tests and coverage.
- `pnpm --dir packages/device-syncd typecheck`.
- Required completion audits, `git diff --check`, and changed-file privacy scan.
- Push the updated PR head and rerun ReviewGPT until no accepted findings remain.

## Outcome

- Replaced the observation-revision CAS after provider revoke with one
  authoritative transaction that disconnects the account and dead-letters
  pending work while preserving repeated-disconnect idempotency.
- Reject missing OAuth state before provider admission, capture callback
  arrival time before waiting, and bound each provider lane to one active
  mutation plus one waiter with a 15-second retryable timeout.
- Preserve reconnect ordering and leave OAuth state unconsumed when capacity or
  timeout rejects admission.

## Verification Evidence

- Focused scheduler, worker, missing-state, capacity, and timeout regressions:
  passed.
- `packages/device-syncd/test/service.test.ts`: 90 tests passed.
- `pnpm --dir packages/device-syncd test:coverage`: 40 files and 730 tests
  passed.
- `pnpm --dir packages/device-syncd typecheck`: passed.
- Security/privacy audit: zero evidence-backed medium-or-higher findings.
- Coverage-write audit: added the worker-progress-during-revoke service proof;
  no production changes.
- `git diff --check` and changed-file privacy scan: passed.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
