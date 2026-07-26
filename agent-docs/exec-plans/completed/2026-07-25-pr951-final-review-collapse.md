# PR 951 final-review cleanup collapse

Status: completed
Created: 2026-07-25
Updated: 2026-07-26

## Goal

- Remove the post-commit loser-cleanup phase from auto Pulse Trial
  finalization and keep the bounded cancellation inside the existing member
  billing lock when the locked decision made no enrollment write.

## Success criteria

- One member-lock transaction owns the authoritative Stripe retrieve, locked
  member re-read, loser decision, and bounded cancellation.
- Successful enrollment never invokes cancellation.
- Cleanup-first ordering prevents a waiting finalizer from adopting stale
  provider state.
- Cancellation failure leaves billing and activation state unwritten and
  returns the existing retryable cleanup failure.
- The cleanup-only database projection, lookup-key classifier, second lock
  acquisition, and their tests are deleted.
- Focused tests, canonical diff verification, acceptance, correction ReviewGPT,
  and current-head CI pass.

## Scope

- `apps/web/src/lib/hosted-onboarding/auto-trial-enrollment-service.ts`
- Cleanup-only surfaces in hosted billing and Pulse Trial cleanup owners.
- Focused auto-trial and member-store tests plus truthful PR documentation.

## Constraints

- Preserve the bounded authoritative retrieve and cancellation requests.
- Preserve the existing member billing lock as the sole serialization owner.
- Do not add persisted coordination, a queue, an outbox, or another retry
  owner.

## Tasks

1. Move loser cancellation into the existing finalization lock callback.
2. Delete the post-commit cleanup lifecycle and its database-only projection.
3. Replace third-transaction tests with single-lock ordering and failure proof.
4. Run required verification, close the plan, rerun final ReviewGPT, and merge.

## Decisions

- Every non-null cleanup outcome is returned before the billing and activation
  writers. Keep the existing finalization lock through bounded cancellation
  instead of releasing it and reconstructing ownership in a second
  transaction.
- Retain the authoritative Stripe retrieve inside the lock so a waiting
  finalizer reads provider state only after an earlier cleanup settles.

## Verification

- Focused Vitest passed 144 cases across the auto-trial service, route, and
  member-store suites.
- Hosted-web typecheck and targeted lint passed.
- Canonical `pnpm test:diff` passed repository guards, TypeScript, 514 hosted
  web test files and 6,553 tests, lint, development smoke, and the production
  build.
- Full `pnpm verify:acceptance` passed repository guards, workspace
  typechecks, package coverage and boundaries, hosted-web verification, the
  production build, and both Cloudflare test lanes.

Completed: 2026-07-25
Completed: 2026-07-26
