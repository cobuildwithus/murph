# Fence subscription Checkout before account deletion

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Prevent a Stripe subscription Checkout URL issued before account deletion
  from creating a paid subscription after Murph has removed the owning member
  or group.

## Success criteria

- Personal and family subscription Checkout sessions are durably associated
  with their local billing owner before their hosted URL is returned.
- Account deletion proves each associated Checkout session terminal before
  deleting local ownership state.
- A Checkout session that races with deletion is either retained under local
  ownership or expired without disclosing a usable URL.
- Focused regression tests, diff-aware verification, acceptance verification,
  required review, and CI pass for the exact draft-PR head.

## Scope

- Hosted billing persistence, personal and family Checkout creation, account
  deletion, focused tests, and current architecture/security documentation.
- One additive Prisma migration for the personal Checkout session reference.

## Constraints

- Preserve current subscription cancellation, customer cleanup, payment
  reconciliation, and deletion recovery behavior.
- Fail closed when Stripe reports an ambiguous or newly completed Checkout
  session until its resulting billing identifiers are reconciled locally.
- Keep Checkout session references private and operational; do not add them to
  account export or UI surfaces.
- Do not add a queue, cleanup service, or second billing owner.

## Risks and mitigations

- Checkout can complete while deletion expires it: retrieve after an expiry
  race and block deletion unless the completed session's billing objects are
  already captured by the deletion target.
- A new Checkout can bind while deletion starts: serialize both operations on
  the existing member lock and recheck suspension before binding.
- Stripe can fail during cleanup: leave local ownership intact and surface the
  existing retryable deletion failure.

## Tasks

1. Persist and encrypt the current personal subscription Checkout session
   reference; tighten family binding under the existing owner lock.
2. Bind Checkout before returning its URL and expire a newly created session
   if local binding loses the deletion race.
3. Expire or prove terminal all captured subscription Checkout sessions before
   local account deletion, including the final target-unchanged assertion.
4. Add focused regression coverage and update current durable invariants.
5. Run required verification and review, then publish an unmerged draft PR.

## Decisions

- Reuse the existing member and family billing-reference owners. Family
  billing already persists its current Checkout session; the member billing
  reference receives the symmetric fields.
- Treat Checkout completion without locally captured customer/subscription
  identifiers as reconciliation still in flight, not as permission to delete.

## Verification

- Focused hosted billing, family-plan, member-store, account-deletion, and
  migration tests.
- Prisma generation and Web typecheck.
- `pnpm test:diff apps/web`
- `pnpm verify:acceptance`
- Required specialist and final ReviewGPT gates plus exact-head CI.
