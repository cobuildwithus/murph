# PR 1041 ReviewGPT round 15 customer ownership

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Remove the provider-effect ownership gap introduced while shortening Pulse
  Trial checkout transactions, without restoring Stripe or crypto work inside a
  database transaction.

## Success criteria

- Pulse Trial and standard first-time billing both commit the existing durable
  Checkout attempt before their only Stripe create call.
- A first-time Pulse Trial does not create a standalone Stripe Customer.
  Subscription-mode Checkout creates the Customer when the user completes the
  owned Session, and completion binds that Customer and Subscription together.
- Account deletion and loser cleanup continue to own the Checkout Session and
  any Customer it creates.
- No provider or crypto call runs while a database transaction is open.
- Focused tests, Web typecheck, canonical diff verification, acceptance
  verification, exact-head CI, and the final ReviewGPT loop pass.

## Scope

- In scope: delete the redundant Pulse Trial checkout Customer reservation
  path and its single-use preparation/binding helpers; restore cleanup helper
  locality; move Pulse Trial completion and event provider preparation plus
  refund/dispute reversal evidence plus loser validation/cancellation outside
  their member transactions; update focused tests and the live product
  contract.
- Out of scope: auto-enrollment Customer creation, billing schema changes,
  unrelated Stripe flows, frontend behavior, or deployment.

## Constraints

- Reuse the existing member-owned Checkout attempt and Session inventory.
- Preserve existing-customer Checkout behavior and Pulse Trial metadata,
  trial duration, idempotency, completion binding, and loser cleanup.
- Prefer deletion over a new claim table, queue, recovery worker, or provider
  reconciliation state.

## Tasks

1. Add a regression proving first-time Pulse Trial uses the durable Checkout
   attempt and never creates a standalone Customer.
2. Delete the redundant reservation, prepared-customer, and exported cleanup
   surfaces.
3. Reduce loser cleanup to provider validation, a short durable-owner
   revalidation transaction, then provider cancellation.
4. Generalize direct Checkout preparation so Pulse completion retrieves live
   provider authority and prepares encrypted bindings before the member lock.
5. Reuse the prepared canonical Stripe event snapshot inside the member
   transaction and revalidate only durable database ownership there.
6. Prepare refund/dispute Subscription, invoice, and payment evidence before
   the member lock, then revalidate its durable owner and current Subscription
   identity inside the lock.
7. Verify completion binding and account-deletion ownership through focused
   tests and parent review.
8. Run canonical verification, finish the scoped plan, push, and continue CI
   plus ReviewGPT until both are green.

## Decisions

- Accept ReviewGPT round 15's ownership-gap finding.
- Do not accept its suggested restoration of a member lock around Stripe and
  crypto I/O because that recreates the database starvation risk.
- Use Stripe Checkout as the sole provider-effect owner for first-time
  subscription checkout. Stripe documents that subscription-mode Checkout
  creates a Customer when `customer` is omitted; the completed Session already
  carries the Customer and Subscription references that Murph binds.
- Preserve the existing loser classifier and durable winner. Validate the
  exact Stripe targets first, revalidate loser status in one short member
  transaction, and perform idempotent provider cancellation only after the
  transaction releases.

## Verification

- Regression-first proof: the first-time Pulse Trial checkout test failed while
  the standalone Customer reservation still existed, then passed after the
  reservation was deleted.
- Before the expanded completion/event preparation fix, focused
  hosted-onboarding Vitest suites passed 345 tests; canonical `pnpm test:diff`
  passed 565 test files / 7,460 tests with lint, dev smoke, and production
  build; and `pnpm verify:acceptance` passed all repository gates.
- After the expanded fix, the five billing, billing-success, Checkout
  completion, event reconciliation, and auto-enrollment suites passed 231
  tests. A second five-suite overlap covering billing events, durable attempt
  acceptance, account deletion, checkout, and reconciliation passed 184 tests.
- The final eight-suite billing, completion, reversal, attempt, cleanup, and
  account-deletion run passed 352 tests.
- `pnpm --filter @murphai/hosted-web typecheck:prepared`: passed after the
  expanded fix.
- Final canonical `pnpm test:diff ...`: passed 565 test files / 7,463 tests,
  Web TypeScript, lint with zero errors, dev smoke, and production build.
- Final `pnpm verify:acceptance`: passed all workspace typechecks, package
  coverage and boundary checks, Web verification and build, and Cloudflare
  verification.

## Progress

- Deleted the first-time Pulse Trial standalone Customer reservation and its
  one-use preparation/binding helpers.
- Kept Checkout Session creation after the durable attempt commit and relied
  on subscription-mode Checkout completion to create the Customer.
- Moved loser-subscription retrieval and cancellation outside the member
  transaction; the transaction now only revalidates durable loser ownership.
- Generalized the existing direct-Checkout preparation boundary to Pulse Trial:
  current Stripe authority, encrypted billing identifiers, and checkout email
  are prepared before the member lock, then the durable attempt is accepted
  atomically inside it.
- Reused the prepared canonical Stripe event snapshot after lock acquisition
  and retained database-owner revalidation inside the transaction.
- Moved refund/dispute Subscription, invoice, and invoice-payment reads before
  the member lock; reversal processing re-resolves the owner inside the lock
  and rejects an ownership change before applying any billing write.
- Updated focused tests and durable billing/reliability contracts.
- The expanded focused suites and Web typecheck pass, including direct
  preparation-before-lock and ownership-change regressions for reversal events.
  Canonical and acceptance verification also pass. The scoped commit,
  exact-head CI, and the final ReviewGPT remediation round remain.
Completed: 2026-07-29
