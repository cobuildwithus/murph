# PR 546 ReviewGPT round 4 remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the authoritative-cohort, deletion-safe traversal, and provider-owner
  gaps found by ReviewGPT round 4, then re-audit and merge PR 546.

## Success criteria

- A finalized pre-cutoff trial remains in the campaign even when its local
  billing row was first written after the cutoff.
- A finalized post-cutoff trial is excluded even when its reservation predates
  the cutoff, while a pre-cutoff provider-only reservation remains discoverable.
- Account deletion cannot shift continuation past an unvisited candidate.
- Route responses keep continuation state opaque and aggregate-only.
- The auto-trial enrollment owner is the sole resolver for provider-only Stripe
  state in Preview and Apply.
- Trialing provider-only state can recover; obsolete provider state can be
  cleaned without disturbing active paid billing; ended paused state is a
  stable non-applicable disposition rather than a page-blocking failure.
- Ambiguous provider state continues to fail closed.
- Required audits, full verification, exact-head ReviewGPT, and CI pass before
  merge.

## Scope

- In scope: campaign cohort predicate, continuation contract, ops route/client,
  auto-trial campaign recovery owner, operator docs, and focused tests.
- Out of scope: recurring campaign state, persisted cursors, a queue, creating a
  replacement subscription, or changing user-triggered enrollment eligibility.

## Constraints

- Use `pulseTrialRedeemedAt` as the authoritative fact for finalized trials and
  reservation `createdAt` only while redemption is absent.
- Use a stateless authenticated-encryption token over the existing member-id
  ordering; never return a raw member identifier.
- Preserve the fixed cutoff, exact Preview proof, bounded Stripe calls, shared
  member mutation lock, idempotency, and aggregate-only logs/responses.
- Do not resume a Stripe `paused` subscription without the payment-method and
  billing semantics Stripe requires; treat an ended trial as non-applicable.

## Tasks

1. Add the mixed authoritative cohort predicate and regression coverage.
2. Replace numeric OFFSET pages with deletion-safe opaque keyset continuation.
3. Move provider-only inspection/disposition into the auto-trial owner.
4. Reuse the owner for locked Apply recovery/obsolete cleanup and stable ended
   dispositions.
5. Update route/UI/runbook and production-faithful regressions.
6. Run required audits, full verification, commit, push, ReviewGPT, and CI.
7. Merge only after zero accepted findings and green final-head checks.

## Decisions

- Accept the cohort and OFFSET findings after tracing Checkout reconciliation
  and supported account-deletion row removal.
- Accept the duplicate provider-owner finding, including the active-paid cleanup
  path and page-blocking paused-state symptom.
- Reject ReviewGPT's suggestion to make a paused, ended subscription deliver a
  new free-trial interval: Stripe documents that this state follows trial end
  without a payment method and resumes into billing after a payment method is
  added. The campaign will instead prove a stable ended/non-applicable owner
  disposition so peers and final closure are not blocked.
- Treat the current paid form of the exact former trial subscription as the
  same stable ended disposition. Clean up only an obsolete exact provider
  subscription whose id differs from the member's current active billing ref.
- Bind Preview/Apply to the opaque continuation as well as the candidate set,
  and keep an explicit Batch 1 reset available after navigation or an invalid
  continuation.

## Verification

- Focused Vitest (service, campaign, route, client): 104/104 passed before the
  final Apply-continuation consistency regression; the client suite then
  passed 18/18.
- Prepared `apps/web` typecheck passed.
- Focused ESLint passed with zero warnings.
- Coverage-write audit: no unresolved gaps; added exact cleanup proof,
  cleanup-target race, and continuation-bound digest regressions.
- Security/privacy audit: no medium-or-higher findings.
- Frontend audit and re-review: Batch 1 recovery finding fixed; no remaining
  medium-or-higher findings.
- `pnpm test:diff apps/web` passed, including dependency/boundary/architecture/
  privacy guards, dev smoke, production Next build, lint with zero errors, and
  4,318 passing tests (9 skipped).
- Exact-head ReviewGPT and final-head CI remain pending.
Completed: 2026-07-12
