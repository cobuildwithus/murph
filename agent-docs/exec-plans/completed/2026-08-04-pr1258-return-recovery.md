# Preserve Stripe plan-change returns through sign-in

Status: completed
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Close PR #1258's immediate plan-upgrade journey when Stripe opens outside the
  member's signed-in browser, while keeping Stripe webhooks as the only billing
  entitlement authority.

## Success criteria

- Allowlisted Pulse and Edge completion returns survive the existing Settings
  sign-in handoff and reach the bounded webhook-sync state.
- Cancellation survives sign-in, then returns quietly to a clean Subscription
  URL.
- Unknown, repeated, malformed, and Group values retain the ordinary signed-out
  redirect and cannot opt into Settings return recovery.
- Duplicate plan controls stay suppressed while the authoritative projection is
  behind the completed target, with focused tests, typecheck, lint, docs, design
  proof, exact-head CI, and the required correction review passing.

## Scope

- In scope: the client-safe plan-return contract, Stripe Portal return URLs,
  Settings signed-out admission and authenticated handling, the existing auth
  resume predicate, the pending-plan UI remediation, focused regressions, and
  matching architecture/product documentation.
- Out of scope: a new auth state owner, billing reconciliation, entitlement
  changes, Stripe account configuration, production migration execution, or
  unrelated billing flows.

## Constraints

- Treat the return query as presentation and navigation context only; never as
  billing or entitlement proof.
- Reuse the existing neutral Settings sign-in screen and exact-current-URL auth
  resume path.
- Keep the migration dry-run-first and deploy it before enabling the one-item
  Portal flow.

## Tasks

1. Suppress duplicate commercial controls while a completed return waits for
   webhook projection, and cover bounded retry, reduced motion, and handoff
   error recovery.
2. Preserve strictly allowlisted completion and cancellation returns through
   the existing signed-out Settings/auth boundary.
3. Run focused verification and design proof, resolve the independent audit,
   commit and push the combined correction, then run exact-head CI and the final
   correction review.

## Decisions

- Encode cancellation in the same allowlisted `planUpdate` return parameter as
  the two direct targets because fragments are not server-visible.
- Strip authenticated cancellation with a server redirect; retain completed
  targets only while the Postgres billing projection differs.
- Reject repeated values before auth recovery and reuse the current browser URL
  reload after sign-in rather than adding cookies or continuation storage.

## Verification

- Focused hosted-web regression slice: 143 tests passed.
- Hosted-web typecheck: passed.
- Focused ESLint: passed.
- Frontend design-proof tests: 10 passed.
- Docs drift and diff check: passed.
- Exact-head CI and ReviewGPT correction round: pending.
Completed: 2026-08-04
