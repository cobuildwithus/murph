# Stripe effect compatibility cutover

This is the expand release for later short-database Stripe effect owners. It
adds nullable claim columns and makes the current member and Family admissions
read them under their existing member-row locks. This release never creates,
reclaims, executes, or clears a claim, and it does not change a Stripe request.

## Deployment sequence

1. Deploy this release by itself. The normal Web predeploy applies the additive
   nullable migration before the application build becomes eligible.
2. Confirm every serving Web instance runs this revision or newer. Do not start
   a claim-enabled release while an older instance can still accept traffic.
3. Drain invocations admitted before convergence. Use the normal deployment
   drain window plus the bounded billing/provider request timeout; confirm no
   pre-cutover Web invocation remains in flight.
4. Before enabling a future claim owner that updates or cancels a Subscription,
   deploy its claim-disabled admission phase. Replace every Stripe Customer
   Portal path that can perform the same Subscription mutation, including
   generic member and Family Portal sessions and
   `subscription_update_confirm` deep links, with that claim owner. Keep invoice
   and payment-method self-service in the Portal, and preserve suspended-member
   cancellation through the replacement owner.
5. For that Subscription-mutation cutover, retire the overlapping Portal
   configurations and drain already-issued sessions before enabling its claim.
   Stripe documents that an unopened Portal session expires after five minutes
   and that an opened session expires within one hour of its most recent
   activity. Reset the one-hour drain on later observed activity. If the last
   activity cannot be proven, keep that writer disabled until Stripe confirms
   the old sessions are invalid or an operator invalidates them through a
   provider-supported mechanism. The session lifetime contract is documented
   in Stripe's
   [Customer Portal guide](https://docs.stripe.com/customer-management).
6. The member Customer-creation owner below may deploy after steps 1-3. A later
   Subscription-mutation owner may deploy only after steps 4-5 also pass and
   each predecessor is terminal.
7. The first persisted claim makes this release the rollback floor. Roll back a
   later owner only to this revision or to a newer claim-aware revision; never
   roll back below it while a claim can exist.
8. Remove the compatibility-only assertions and columns only in a later
   contract change after every claim owner is deployed, all pre-owner revisions
   and invocations are impossible, no live claim remains, and no supported
   rollback target needs these columns.

If the convergence and invocation drain in steps 1-3 cannot be proven, stop
before deploying any claim writer. Steps 4-5 are additional prerequisites only
for a writer that overlaps a Portal Subscription mutation. Rollback of this
expand release is safe only before any later release persists a claim. After
that point, recovery is a forward fix or rollback to this floor.

## Member Customer creation owner

The first member claim writer moves reusable Stripe Customer creation out of
the member-row transaction. It may be enabled after deployment steps 1-3 above
are complete. It does not update or cancel a Subscription and may coexist with
Stripe Customer Portal subscription management: Murph can issue a Portal
session only from an existing stored Customer, while this owner reuses that
Customer without creating a claim or calling Stripe. Customer creation claims
exist only while no stored Customer is available.

Its ownership contract is:

- Preparation locks and revalidates the member, then persists one opaque
  `member.customer-create` claim on the existing member billing row before
  calling Stripe. Another active claim remains a retryable conflict.
- Stripe Customer creation runs with no database transaction open and retains
  the existing member-scoped provider idempotency key. A provider error leaves
  the claim intact; replay recognizes only that exact claim shape and repeats
  the same idempotent request.
- Finalization locks and revalidates the member, requires that exact persisted
  claim, and atomically binds the encrypted Customer identity and lookup key
  while clearing every claim field. An already-bound Customer remains the
  terminal replay result.
- Preparation rejects retryably when the billing row already owns a bound direct
  Checkout Session. It therefore cannot start a competing Customer provider call
  after Checkout may create its Customer. The reverse ordering is enforced by
  direct Checkout's existing claim-aware admission under the same member lock.
- An attempt that has not yet bound its Session does not block preparation. If
  Stripe creates that Session after a claim wins, Checkout's existing
  post-create revalidation retains its exact pre-create Customer state and
  safely deletes the unbound Session Customer. No provider-Customer ownership
  is inferred from a completed Session.
- Before suspension, account deletion asks this owner to resume only an exact
  existing `member.customer-create` claim. The owner repeats the established
  idempotent Stripe request, then binds the Customer and clears the claim before
  ordinary deletion captures and cleans up that Customer. No claim admits no
  provider call, an unrelated claim remains a retryable conflict, and provider
  failure preserves the claim without partial suspension.

The claim is short-lived on an ordinary success path and intentionally durable
after an ambiguous provider outcome. The first persisted member Customer claim
activates the rollback floor in step 7; recovery must not serve a revision that
does not understand member billing-row claims.

## Verification

Run the unit and migration suite, then apply all Web migrations to an isolated
loopback PostgreSQL database and run:

```bash
DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 \
  pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-onboarding-member-lock-postgres.test.ts
```

The compatibility cases seed a future claim while holding the production
claim-owner row, start an independent current-revision writer, prove PostgreSQL
reports that writer waiting on the row lock, then commit the claim. Direct
customer creation, direct Checkout against a claim-only owner group, exact
direct Subscription upgrade and scheduling, Family capacity, owner relationship
authority, and owner and beneficiary account deletion must all reject retryably
without a provider request or partial suspension. Family claims serialize on
the group owner before a distinct beneficiary; a removed member remains
discoverable through the immutable claim beneficiary. Family Portal admission
reads only the owner group and five billing authority scalars in each of its two
short lock transactions; it performs no roster, invite, contact, capacity, or
external-key work while locked, and decrypts only the Customer id between the
first transaction and provider call. Terminal claim removal restores direct
admission. An accepted direct `invoice.payment_failed` receipt that overlaps a
claim-only owner group remains failed/retryable beyond the ordinary poison cap;
after claim removal, the same receipt applies the canonical `past_due`
projection and completes.

The member Customer owner case leaves a committed claim after an ambiguous
provider response and removes the initiating request. It then proves one
account-deletion retry during provider unavailability preserves the claim and
does not suspend the member. A later retry repeats the identical Stripe
idempotency key, binds and clears the claim, captures the Customer in ordinary
deletion, and completes provider cleanup. The bound direct Checkout race proof
also runs both owner orders. Completion-first causes Customer preparation to
wait on the member lock and reuse the accepted Checkout identity.
Customer-admission-first rejects before provider egress because the bound
Session already owns the member, after which completion binds the sole Customer
normally. The existing attempt-only race separately proves a claim that commits
before Session creation triggers exact unbound-Session cleanup.
