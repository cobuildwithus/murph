# Restore paused Pulse subscription billing

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

Allow an eligible member with a paused Pulse Trial and a saved Stripe payment
method to start paid Pulse immediately.

## Proven production symptom

- The production route reached the paused-subscription resume operation.
- Stripe rejected that operation with `parameter_unknown` for
  `default_payment_method`.
- The affected subscription remained paused and the local billing projection
  did not advance, so no successful charge was recorded.

## Root cause

Murph passed `default_payment_method` to Stripe's subscription resume endpoint.
That endpoint does not accept the field, so the resume request failed before
billing could begin. The subscription already inherits the expanded customer's
default payment method when it has no subscription-level override.

## Success criteria

- The resume call uses only parameters accepted by Stripe's resume endpoint.
- The corrected request uses a new deterministic idempotency operation version,
  so it cannot collide with the failed old request shape.
- Customer-level payment-method inheritance remains intact so a later normal
  Stripe Portal update is not shadowed by a pinned subscription-level default.
- Existing plan-item transition, metadata cleanup, idempotency, invoice
  reconciliation, and payment-action recovery behavior remain intact.
- Focused billing tests, web typecheck, the required acceptance gate, and the
  routed cross-cutting review pass are run before the direct `main` push, with
  any unrelated pre-existing acceptance failures recorded explicitly.

## Tasks

1. Add a focused regression that proves update-before-resume parameter routing.
2. Remove the unsupported payment-method field from the resume payload, bump
   that request's idempotency operation version, and preserve the existing
   pre-resume update and Stripe inheritance behavior.
3. Run focused billing proof, typecheck, diff/privacy review, and the exact
   candidate acceptance gate.
4. Run the required local cross-cutting review, resolve findings, close this
   plan with the scoped commit, reconcile `origin/main`, and push to `main`.

## Verification log

- Focused billing regression: 58/58 tests passed.
- Web typecheck passed.
- `pnpm verify:acceptance` ran against the exact candidate. Repository guards,
  workspace typechecks, documentation and artifact checks, the web production
  build, and the billing tests passed. The command exited nonzero only for
  untouched existing failures: the CLI participant-binding rejection test,
  two frozen Prisma migration-history assertions, and six assistant-runtime
  conversation-shape assertions expecting no explicit null session identifier.
- The routed deep review found and removed an attempted subscription-level
  payment-method override that would have shadowed later customer default-card
  changes. It also prompted the resume idempotency operation bump to v2. The
  final revised candidate had no unresolved production-breaking findings.
- `git diff --check` and the scoped identifier/privacy scan passed.
Completed: 2026-08-06
