# Fence subscription Checkout before account deletion

Status: completed
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
- Settle an abandoned personal Checkout, retain its ownership through provider
  creation, and compare-and-swap it only after a replacement exists. Derive the
  replacement idempotency scope from the terminal Session so a failed provider
  create retries the same replacement instead of replaying an older checkout.
- Bound all deletion-time subscription Checkout calls by the existing shared
  five-second immediate-attempt budget with Stripe network retries disabled.

## Review dispositions

- Accepted product finding: a distinct bound Session could permanently block a
  later plan. Added terminal reconciliation, exact compare-and-swap, a retry
  idempotency suffix, and focused success, ambiguous-expiry, and
  replacement-create retry tests. The focused product re-review returned no
  findings after remediation.
- Accepted product finding: deletion-time Checkout calls inherited Stripe's
  long default timeout/retries. Added one shared foreground deadline and request
  option proof.
- Parent final review: a transient Family binding error expired the
  same-attempt Session and could make its idempotent retry unusable. Restricted
  expiry to definitive stale ownership and added focused regression proof.
- Rejected product finding: definite deletion errors reload away the message.
  That behavior predates this change across every provider failure in account
  deletion; this patch does not uniquely create the recovery contract, so the
  broader authority/UI redesign remains outside this billing fence.
- Accepted specialist findings: added real PostgreSQL personal/Family lock
  ordering in both winner directions and focused fail-closed tests for missing
  configuration, provider errors, unresolved mode/status, and incomplete
  completed-Session identifiers. ReviewGPT returned no patch artifact.

## Verification

- Focused hosted billing, family-plan, member-store, account-deletion, and
  migration tests: 5 files and 306 tests passed after final remediation.
- Prisma generation and Web typecheck passed.
- `pnpm test:diff apps/web` passed: 539 test files and 6,879 tests, lint with
  the 14 existing unrelated warnings, dev smoke, and production build.
- `pnpm verify:acceptance` passed before the final narrow Family retry
  remediation. The exact final tree rerun completed all changed Web checks but
  reported two unrelated host-contention failures: the Setup CLI Venice wizard
  assertion and the Core old-causal-token replay test's 60-second timeout. Both
  passed immediately in isolation (6/6 and 21/21 respectively); the final
  remediation is covered by the exact diff suite and focused Family test.
- Opt-in PostgreSQL member-lock suite: 18 tests passed against the isolated,
  fully migrated worktree database.
- Preliminary ReviewGPT returned findings with no patch artifact; accepted
  findings were remediated. Final ReviewGPT and exact-head CI remain the PR
  sealing gates after this plan closes.
Completed: 2026-07-27
