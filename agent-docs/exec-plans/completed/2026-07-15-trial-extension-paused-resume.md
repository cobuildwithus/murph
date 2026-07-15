# Paused Pulse Trial resume recovery

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Make single-member Apply safely recover and extend a lapsed Stripe Pulse
  Trial that has entered Stripe's `paused` status.

## Root-cause evidence

- The deployed diagnostic recorded `update_subscription`,
  `StripeInvalidRequestError`, and HTTP 400 for the affected Apply.
- Preview had already retrieved and accepted the subscription as a lapsed
  paused Pulse Trial; only the update path failed.
- Stripe's current trial contract requires a paused subscription to be resumed
  before a new trial is configured. The implementation directly set
  `trial_end` while the subscription was paused.

## Success criteria

- Paused subscriptions are prepared, resumed with the billing anchor unchanged
  and no proration (so the resume creates no billable invoice), and placed into
  the exact target trial under the existing shared member mutation lock.
- A response loss or deterministic failure after any provider mutation leaves
  a bounded provider-side marker that a later Preview and Apply can recover.
- Trialing subscriptions retain the existing one-call extension behavior.
- Local billing is written only after Stripe proves the final trialing shape;
  ambiguous provider success and local-write failure reconcile without adding
  another seven days.
- Provider diagnostics remain identifier-free and distinguish prepare,
  resume, update, and validation failures.
- Focused tests, state-consistency audit, routed verification, coverage audit,
  ReviewGPT, CI, deployment, and production Preview/Apply proof are complete.

## Constraints

- Stripe remains authoritative for subscription status and trial dates.
- Do not create an invoice, collect payment, or expose provider identifiers.
- Preserve the existing preview proof, mutation lock, local reconciliation,
  and exact-marker idempotency boundaries.
- Add no schema, dependency, queue, retry service, or second billing owner.

## Risks and mitigations

1. Resume can succeed before the trial update fails.
   Mitigation: write an operation/target marker while still paused, use stable
   per-step idempotency keys, and recognize only that exact marker as a
   recoverable active intermediate state.
2. A final Stripe update can commit while its response is lost.
   Mitigation: bind the marker to the exact target and reconcile a fresh
   Preview when provider state matches but local billing does not.
3. Stripe webhooks can observe intermediate provider states.
   Mitigation: retain the Pulse Trial offer marker and reconcile local billing
   only from canonical Stripe events or the final proven trialing response;
   test partial paths and event-owned state assumptions.
4. Resetting the billing anchor while resuming can immediately start a billed
   period.
   Mitigation: resume with `billing_cycle_anchor=unchanged` and
   `proration_behavior=none`; Stripe documents that combination as creating no
   debit proration or new invoice. The final trial update owns the next anchor.
5. Multiple network calls can approach the transaction timeout.
   Mitigation: keep network retries disabled, skip already completed steps,
   and make every completed provider step recoverable on the next request.

## Tasks

1. Map provider/local coupled state and every prepare/resume/update failure
   boundary using the state-consistency audit.
2. Add the narrow recoverable marker and paused prepare/resume transition.
3. Add focused coverage for success, response loss after each step, fresh
   Preview recovery, exact idempotency, validation, and unchanged live trials.
4. Run focused and routed verification, required completion audits, and parent
   final review.
5. Finish the scoped commit, open the PR, run ReviewGPT with CI, merge/deploy,
   and verify the affected member from production without applying twice.

## Verification

- Production diagnostics reproduced the failure twice as
  `update_subscription`, `StripeInvalidRequestError`, HTTP 400, with no
  provider or member identifiers emitted.
- State-consistency audit verified and resolved the recoverability gaps after
  prepare, resume, final provider update, and local-write failure. No
  unresolved coupled-state finding remains.
- Required coverage-write audit added local-write-loss reconciliation proof and
  found no remaining material coverage gap; the focused four-file billing
  suite passed 72 tests.
- `pnpm test:diff` passed all workspace guards, hosted-web TypeScript, dev
  smoke, 5,110 tests (139 skipped), lint with zero errors and 12 unrelated
  pre-existing warnings, and the optimized Next production build.
- Parent final review corrected the resume anchor to `unchanged` with no
  proration so the intermediate provider transition does not start a billable
  period or create a new invoice.

## State

Implementation, local verification, coverage audit, state-consistency audit,
and parent review are complete. PR ReviewGPT, CI, deployment, and the final
production Preview/Apply proof remain external release gates.
Completed: 2026-07-15
