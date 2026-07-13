# PR 546 ReviewGPT round 5 remediation

Status: completed
Created: 2026-07-12
Updated: 2026-07-12

## Goal

- Close the three production-reachable ReviewGPT round 5 findings, then
  re-audit, re-review, and merge PR 546.

## Success criteria

- Pulse card checkout binds the member's durable Stripe customer owner before
  creating Checkout.
- A delayed Pulse card Checkout that loses to auto-enrollment is classified
  under the shared member Stripe mutation lock and canceled before its Stripe
  receipt is acknowledged.
- The campaign cannot close while an exact pre-cutoff Pulse subscription lacks
  a local billing owner.
- A valid provider-only trial is extended and finalized in one locked terminal
  Apply operation with the same exact-shape and runway rules as ordinary
  extension.
- Exact ended former trials resolve from provider truth without depending on a
  stale local billing projection.
- Optional wake and welcome effects cannot relabel or outlive committed
  campaign work.
- Required audits, full verification, exact-head ReviewGPT, and final-head CI
  pass before merge.

## Scope

- In scope: Pulse Checkout customer ownership, bounded historical provider
  reconciliation, provider-only classification/application, route budget
  propagation, operator UI/runbook, and focused regressions.
- Out of scope: recurring campaign state, a new queue, a persisted campaign
  cursor, replacing existing durable mailbox continuation, or changing
  non-Pulse checkout behavior.

## Constraints

- Reuse the existing hosted billing owner, member mutation lock, exact Pulse
  metadata/price shape, authenticated continuation, and durable activation
  mailbox.
- Keep provider discovery bounded and resumable, with exact pre-cutoff proof.
- Preserve idempotency when Stripe succeeds and local finalization retries.
- Optional effects are latency hints only and must have a remaining-deadline
  cap or be skipped.

## Tasks

1. Bind a durable Stripe customer owner before Pulse card Checkout creation.
2. Add bounded provider-to-owner reconciliation to the campaign traversal and
   make it part of the closure condition.
3. Collapse provider-only recovery and extension into one exact, terminal,
   locked Apply path with replay-safe finalization.
4. Separate committed results from deadline-capped optional effects.
5. Simplify UI/runbook states and add production-faithful regressions.
6. Close the delayed card-Checkout/auto-enrollment race with retry-safe loser
   cleanup under the shared member Stripe mutation lock.
7. Run required audits and full verification, then commit and push.
8. Require a zero-finding exact-head ReviewGPT pass and green final-head CI,
   reconcile with main, and merge.

## Decisions

- Accept all three round 5 findings after tracing the supported card Checkout,
  provider-only timing boundary, and post-commit effect paths.
- Prefer one durable billing owner and one terminal provider classifier over
  adding campaign-specific obligation tables or another repair state.
- Reuse the durable activation mailbox as the continuation when immediate
  wake/email effects cannot fit inside the route budget.
- Treat the durable redeemed subscription as the winner when an older hosted
  Checkout completes later; cancel only an exact valid losing Pulse
  subscription, and retry the Stripe event until cleanup succeeds.

## Verification

- Required coverage-write, frontend, and security/privacy audits completed;
  the final security/privacy re-audit found no medium-or-higher issue.
- Focused billing/campaign/route/client verification passed: 9 files and 203
  tests.
- Prepared hosted-web typecheck and focused ESLint passed.
- `pnpm test:diff apps/web` passed: dependency, boundary, Temporal, crypto,
  and raw-health-log guards; dev smoke; lint with zero errors; production Next
  build and typecheck; 4,338 tests passed with 9 skipped.
- Exact-head ReviewGPT and final-head PR CI remain pending before merge.
Completed: 2026-07-12
