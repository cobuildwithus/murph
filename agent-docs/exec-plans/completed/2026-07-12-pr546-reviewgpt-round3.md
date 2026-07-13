# PR 546 ReviewGPT round 3 remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the remaining production reachability and bounded-work gaps in the
  one-time Pulse Trial extension campaign, then re-audit and merge PR 546.

## Success criteria

- Stable local ineligibility is previewed, proved, and skipped during Apply
  without blocking eligible members later in the same fixed page.
- A local eligibility transition after Preview still rejects Apply as stale.
- Ops lock acquisition and candidate starts are bounded by the route-wide
  deadline, with no Stripe work after insufficient-runway or lock-busy results.
- Final campaign verification cannot declare the fixed pre-cutoff cohort closed
  while a recoverable provider-only pre-cutoff Pulse trial remains unadmitted.
- The deleted script's proofless, unbounded execution mode is removed from the
  production service and its types.
- Focused/full verification, required audits, exact-head ReviewGPT, and PR CI
  pass before merge.

## Scope

- In scope: Pulse Trial campaign service, bounded Stripe mutation locking,
  cohort-closing preflight, route/UI/operator documentation, and focused tests.
- Out of scope: a recurring campaign, a new queue, a new persisted campaign
  model, changing the durable redemption timestamp, or weakening normal billing
  and webhook lock semantics.

## Constraints

- Keep campaign traversal fixed by the immutable local billing-reservation
  timestamp and existing end-exclusive cutoff; use redemption time only to
  distinguish enrolled, provider-only, and post-cutoff members.
- Preserve aggregate-only responses, exact Preview proof, Stripe idempotency,
  one source of truth for enrollment recovery, and the shared member lock.
- Add only Ops-specific bounded lock behavior; do not shorten canonical webhook
  or billing transactions.

## Tasks

1. Reproduce and fix stable local-skip versus stale-transition behavior.
2. Add an operation deadline and Ops-specific bounded lock acquisition.
3. Add a provider-authoritative cohort-closing verification preflight.
4. Delete proof-optional and unbounded scanner paths.
5. Update operator docs/UI and add production-faithful regressions.
6. Run focused/full verification and required audits.
7. Commit, push, rerun ReviewGPT and CI, and merge only at zero accepted findings.

## Decisions

- Accept the stable-local-skip and route-budget findings after tracing the
  current locked reread and 800-second route/provider budgets.
- Keep local eligibility out of the cohort membership query; include it in the
  Preview snapshot and prove it under the lock instead.
- Accept the provider-only admission finding: no-card enrollment creates the
  local billing reservation before Stripe, so the fixed pre-cutoff reservation
  cohort can discover and safely recover the provider-only state.
- Reuse the existing auto-trial finalization owner for provider-only recovery;
  do not add a second billing writer or create another Stripe subscription.
- Replace the inherited proof-optional, open-ended scanner with one explicitly
  bounded page whose Apply input requires the complete Preview proof.
- Bound Ops lock acquisition to 25 seconds, each candidate transaction to 190
  seconds, and candidate admission to a 780-second route work budget.
- Preserve the dedicated non-retryable incomplete-lookup error when the bounded
  Stripe recovery read reports more than one page.

## Verification

- Required coverage-write audit: passed; three focused regressions added.
- Required security/privacy audit: no medium-or-higher findings.
- Required frontend audit: recovery-first operator copy clarified; no remaining
  medium-or-higher findings. Authenticated screenshot proof was unavailable, so
  source and DOM interaction tests covered the UI.
- Focused changed-file ESLint: passed with zero warnings.
- Prepared web typecheck: passed.
- Web test suite: 380 files passed, 1 skipped; 4,305 tests passed, 9 skipped.
- `pnpm test:diff apps/web`: passed, including dependency/boundary/security
  guards, lint, tests, dev smoke, typecheck, and production Next build. Existing
  unrelated repository lint/build warnings remain warning-only.
- `git diff --check`: passed.
- Exact pushed-head ReviewGPT and GitHub CI remain before merge.
Completed: 2026-07-12
