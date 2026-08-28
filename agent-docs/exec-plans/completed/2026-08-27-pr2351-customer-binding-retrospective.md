# Close the Stripe Customer binding race

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Keep Stripe Customer provider calls outside database transactions while
  guaranteeing that every direct Checkout completion and usage-credit Customer
  creation resolves to one durable member-owned Customer identity.

## Success criteria

- An already-issued direct Checkout completion cannot bind a competing Customer
  while `member.customer-create` owns the billing row.
- The losing Checkout Subscription is canceled and any ordinary payment is
  refunded by the existing completion owner after the claim's candidate wins;
  its Customer never becomes local product truth.
- Real PostgreSQL interleavings prove both writer start orders without provider
  work inside a transaction or a stranded claim.
- Focused Web tests, typecheck, exact-head ReviewGPT, required CI, protected
  merge, production deploy proof, and database telemetry all pass.

## Scope

- In scope: the existing member Customer claim, the existing direct Checkout
  completion acceptance owner, focused unit/PostgreSQL proof, and the matching
  operational contract.
- Out of scope: new persisted state, queues, retry managers, reconciliation
  services, portal redesign, Family billing, plan switching, and schema changes.

## Constraints

- Technical constraints: keep all provider and crypto work outside short
  database-only transactions; serialize current writers with the existing
  member-row owner; preserve Stripe request idempotency and cleanup ownership.
- Product/process constraints: preserve checkout, suspended-member cancellation,
  account deletion, and rollback-floor behavior; keep the PR draft until its
  exact pushed candidate has resolved review and focused proof.

## Risks and mitigations

1. Risk: a Checkout Session issued before claim creation completes while the
   usage-credit Customer provider call is in flight and binds another Customer.
   Mitigation: make the existing Checkout completion acceptance owner reject the
   active claim under its existing member lock; retry-owned completion then sees
   the claim winner and uses the existing superseded cleanup path.
2. Risk: a tactical fix grows another billing lifecycle.
   Mitigation: add no owner or state; reuse the current member lock, claim field,
   completion acceptance, and cleanup result.
3. Risk: one writer order is proven only with mocks.
   Mitigation: add a real PostgreSQL barrier test covering Checkout-first and
   claim-first ordering and assert provider cleanup plus terminal database state.

## Tasks

1. [x] Perform the requirement retrospective and map every Customer-binding
   writer.
2. [x] Reconcile current `main` without changing the intended owner contract.
3. [x] Apply the smallest acceptance-owner correction and direct proof.
4. [x] Run focused verification and update candidate evidence.
5. [x] Recover the immutable ReviewGPT baseline, previous-head evidence, same
   thread, and exact browser lane for the next round.
6. [x] Prepare the scoped candidate for exact-head PR review, CI, merge,
   production proof, and worktree retirement under the normal completion flow.

## Decisions

- Original requirement: remove Stripe Customer egress from the member-row
  transaction without losing eligibility, deletion, or one-Customer ownership.
- First-reviewed head `4f7f669885e9` introduced the two short transactions and
  one persisted member claim. Current head `b94fe113a1cf` added 79 source lines,
  175 test lines, and 33 documentation lines while deleting 7 source and 9 test
  lines to make the claim exact, replayable, and account-deletion-aware.
- The repeated mechanism is an incomplete writer inventory: finalization
  accepts an already-bound winner, but direct Checkout completion can become
  that winner after a Session was issued before the claim.
- Decision: continue with a smaller existing-owner correction. The direct
  Checkout completion acceptance function owns completed Session Customer
  bindings under the same member lock and already returns a terminal
  superseded-cleanup result. Signed subscription, invoice, refund, and dispute
  events share `writeHostedMemberStripeBillingTx`; that shared writer will
  enforce the same claim before changing member or billing state. No new owner,
  state, migration, repair pass, or lifecycle is justified.
- The existing loser cleanup safely cancels the exact Subscription and refunds
  its ordinary payment. It intentionally does not delete the associated
  Customer because a completed Session does not durably prove whether Checkout
  created that Customer or reused one supplied at Session creation. Adding a
  persisted ownership bit only to delete an otherwise unbound provider object
  would expand this correction without protecting member product truth.
- The immutable first-reviewed baseline remains `4f7f669885e9` for later rounds.

## Verification

- Commands to run: focused Customer/Checkout Vitest, real PostgreSQL concurrency
  test with all Web migrations applied, focused ESLint, Web typecheck, billing
  CI guard, docs drift, diff/privacy checks, PR evidence, and current-base
  merge-tree.
- Expected outcomes: both interleavings converge on the claim Customer, direct
  Checkout returns retryably while claimed and later cleans its loser, no claim
  remains after success, and every static/contract check passes.

## Results

- PostgreSQL proof passes both Checkout-first and claim-first orderings. The
  Checkout-first writer owns the member before Customer preparation; the
  Customer path reuses the committed Checkout identity without a provider call.
  The claim-first writer blocks both `customer.subscription.created` projection
  and direct completion until the provider candidate binds and clears the
  claim; direct completion then returns the existing superseded-cleanup result.
- The production correction is seven lines across the direct acceptance owner
  and shared signed-event billing writer. Focused unit proof passes 47 tests and
  the real PostgreSQL file passes 40 tests.
- Web typecheck, focused ESLint, the hosted-billing CI guard, docs drift, diff
  validation, and the privacy/domain scan pass. The next ReviewGPT round stays
  on the original thread and immutable first-reviewed baseline; the PR remains
  draft until that exact-head review and required CI resolve.
Completed: 2026-08-27
