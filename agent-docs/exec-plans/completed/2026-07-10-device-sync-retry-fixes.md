# Device Sync Retry State-Transition Fixes

Status: completed
Updated: 2026-07-10

## Why

A returned targeted bug-fix patch identified two device-sync state-transition
bugs in `packages/device-syncd`:

- stale workers could complete or bulk-dead-letter work after losing ownership
- a local disconnect could clobber a concurrent reconnect and was not
  idempotent

These are persisted job/account correctness issues, so the fix must stay narrow
and prove the affected races with focused regressions.

## Scope

Apply and verify the returned device-sync patch intent only:

- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/src/store.ts`
- `packages/device-syncd/src/store/accounts.ts`
- `packages/device-syncd/src/store/jobs.ts`
- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/test/service.test.ts`

No schema change, new state owner, queue, scheduler, or broad device-sync
refactor is planned.

## Plan

1. Apply the returned patch.
2. Inspect the changed call paths for ownership fences, transaction boundaries,
   and reconnect/disconnect behavior.
3. Run focused device-sync verification, then the repo-required scoped lane.
4. Run required completion audits: security/privacy, coverage-write, and
   deep-review.
5. Resolve any accepted findings, rerun required checks, then finish with a
   scoped commit through `scripts/finish-task`.

## Verification

Completed commands:

- `git diff --check`
- focused `packages/device-syncd` service-test regressions: 7 tests passed
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/device-syncd test:coverage`: 40 files, 726 tests passed
- `pnpm test:diff packages/device-syncd/src/service.ts packages/device-syncd/src/store.ts packages/device-syncd/src/store/accounts.ts packages/device-syncd/src/store/jobs.ts packages/device-syncd/test/service.test.ts`: device-syncd checks passed before unrelated reverse-dependent failures

## Completion Notes

- Applied the returned owner-fenced worker terminal transitions and guarded
  account-wide dead-lettering.
- Added guarded disconnect/account job-cancellation store primitives and
  idempotent disconnect behavior.
- Resolved completion-audit findings by reactivating successful reconnect
  upserts and serializing provider connection mutations with disconnect revoke
  in the service process.
- Security/privacy review found no findings.
- Coverage-write added a reauthorization lease-loss regression.
- Deep review findings were fixed and the follow-up review found no remaining
  production-breaking issue; residual caveat is process-local serialization for
  the single service owner of a state DB.
- The broad `pnpm test:diff` lane failed in unrelated reverse-dependent
  assistant-runtime, CLI experiment journal, and hosted-local-harness tests
  after device-syncd checks had passed.
- No deployment-skew concern identified.
Completed: 2026-07-10
