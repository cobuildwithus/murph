# PR 513 ReviewGPT round 2 remediation

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Validate and, where proven, close the three ReviewGPT round-two candidates without broadening the one-time campaign architecture.

## Success criteria

- A webhook cannot commit a stale canonical Stripe snapshot after a serialized billing transition.
- Every failure after a successful Start paid provider mutation enters canonical provider reconciliation.
- Eligible active trials without a pre-existing lazy usage-period row still receive the extension through the usage owner.
- Production-faithful regressions prove each accepted correction.
- Required verification, completion audits, exact-head ReviewGPT rerun, and PR checks pass.

## Constraints

- Reuse the existing hosted-member row lock and existing Stripe/billing/usage owners.
- Keep Stripe authoritative; preserve usage spend, block state, trial start, billing events, and ledger history.
- Add no new durable state, fence, queue, manager, or broad transition abstraction.
- Treat the current ReviewGPT response as candidate evidence because it reported `MODEL_CONFIRMATION: UNKNOWN`.

## Tasks

1. Validate the webhook stale-snapshot interleaving and identify every canonical-subscription billing write path.
2. Validate the post-mutation paid-invoice failure boundary.
3. Validate lazy usage-period creation and owner reconciliation.
4. Implement only proven narrow corrections with focused tests.
5. Run audits and verification, close with a scoped commit, push, and rerun ReviewGPT.

## Decisions

- Accept all three ReviewGPT candidates after independent code-path validation; the response's `MODEL_CONFIRMATION: UNKNOWN` prevents treating that round as the formal final gate.
- Resolve direct subscription and subscription-backed invoice members from immutable event references, then use the existing member Stripe-mutation lock before retrieving canonical Stripe state and writing billing in the same transaction.
- Keep the Start paid mutation-completed flag and widen its existing catch through shape validation and invoice reconciliation; do not add another retry layer.
- Delete campaign-owned usage-row reads, eligibility, and writes. Reconcile the lazy aggregate through a narrow usage-owner transaction helper after authoritative billing is updated.
- Keep checkout, family, schedule, refund, and dispute event paths unchanged because they cannot reach the proven direct-trial stale-window race.
- Extend the event claim lease to the bounded provider-prefetch plus 780-second locked-phase budget, and guard finalization by the claimed attempt generation so an expired worker cannot overwrite a reclaimed attempt.

## Verification

- Combined focused Vitest: 162 tests passed after the final lease correction.
- Web TypeScript check: passed.
- Focused ESLint: passed.
- Coverage-write audit: clean; no additional regression required.
- Security/privacy re-audit: clean with no medium-or-higher issue.
- Simplify re-audit: clean.
- Final `pnpm test:diff`: passed, including 4,060 hosted-web tests (9 skipped), ESLint with 0 errors and 9 pre-existing warnings, dev smoke, and the 181-page Next.js production build.
- Initial task-finish review: finish-ready.
- Final bug hunt: one medium claim-lease/finalization race found and corrected with a deferred reclaim regression.
- Post-correction task-finish review: finish-ready.
- Pushed-head ReviewGPT rerun and final PR checks: pending.
Completed: 2026-07-10
