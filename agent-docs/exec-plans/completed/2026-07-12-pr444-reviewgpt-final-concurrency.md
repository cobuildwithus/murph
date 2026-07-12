# PR 444 Final ReviewGPT Concurrency Fixes

## Goal

Resolve the two accepted findings from the final ReviewGPT audit of pushed head
`07a7f588`: a Family roster snapshot race and delivery of stale Call Circle
setup or confirmation notifications after cancellation.

## Constraints

- Serialize Family roster and access-revoking billing mutations through the
  owning account-group row before taking canonical hosted-member locks.
- Preserve beneficiary accounts when a Family owner is deleted.
- Revalidate invite and owner authority after the account-group lock is held.
- Supersede only unconsumed Call Circle setup/confirmation notifications;
  terminal cancellation, expiry, handoff, and outcome notices remain eligible.
- Make the final delivery claim atomic with cancellation and immediately before
  provider acceptance, without a new queue or persisted-state owner.
- Keep memory-heavy verification serial and preserve unrelated work.

## Working Set

- `apps/web/src/lib/hosted-onboarding/family-plan.ts`
- `apps/web/src/lib/hosted-privacy/account-data-service.ts`
- `apps/web/src/lib/call-circle/**`
- `apps/web/app/api/internal/hosted-runtime/**`
- `apps/cloudflare/src/runtime-platform/effects-port.ts`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/hosted-execution/src/**`
- matching focused tests and hosted-runtime documentation

## Verification Plan

- Focused unit and PostgreSQL barrier tests for both orderings of invite
  acceptance versus owner deletion and access-revoking billing updates.
- Focused cancellation/delivery-claim race tests, including an already-selected
  wake and preserved terminal notices.
- Affected package typechecks, lint/guards, and serial affected-diff tests.
- Required security/privacy and coverage completion passes, parent final review,
  scoped finish-task commit, push, exact-head CI/thread/merge-state evidence.

## Verification Results

- Focused hosted-web behavior: 7 files, 227 tests passed.
- PostgreSQL barrier coverage on a fresh migrated database: 3 files, 14 tests
  passed, covering both orderings for Family deletion/billing and Call Circle
  provider-entry claim/supersession.
- Hosted-execution focused behavior: 8 tests passed.
- Assistant-runtime focused callback behavior: 138 tests passed.
- Cloudflare runner boundary behavior: 2 files, 292 tests passed.
- Hosted-execution, assistant-runtime, Cloudflare, and hosted-web prepared
  typechecks passed.
- The serial affected-diff lane passed all task-owned packages and guards. Its
  only failure was the unrelated Setup CLI Venice wizard case. The focused
  six-test rerun reproduced the stale React-ref result; the current diff has no
  Setup CLI, assistant-engine, assistant-cli, or operator-config changes.
- The parent completion pass additionally locked and revalidated current member
  access/enrollment plus pending-match authority at provider entry, removed an
  unused wrapper, and moved owner-suspension validation behind the owner lock.
  The final focused rerun passed 89 unit tests and 7 fresh-database barrier
  tests; the hosted-web prepared typecheck passed again.
- `git diff --check` and tracked/untracked privacy scans passed.
- Targeted hosted-web ESLint, docs drift, and 205-scenario manifest integrity
  checks passed.
- Parent security/privacy, coverage, simplify, and task-finish passes found no
  remaining task-scoped issue after the authority and lock-order corrections.

Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
