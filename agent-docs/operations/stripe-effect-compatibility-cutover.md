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
4. Before any claim writer is reachable, deploy its claim-disabled admission
   phase. That phase must replace every Stripe Customer Portal path that can
   update or cancel a Subscription, including generic member and Family Portal
   sessions and `subscription_update_confirm` deep links, with the matching
   claim-owned mutation. Keep invoice and payment-method self-service only
   through a Portal configuration that cannot mutate a Subscription. Preserve
   suspended-member cancellation access through the replacement claim owner;
   do not remove that user-critical escape path.
5. Retire the mutation-capable Portal configurations, then drain already-issued
   sessions before enabling claims. Stripe documents that an unopened Portal
   session expires after five minutes and that an opened session expires within
   one hour of its most recent activity. Reset the one-hour drain on any later
   observed activity. If the last activity cannot be proven, keep claims
   disabled until Stripe confirms that the old sessions are invalid or an
   operator invalidates them through a provider-supported mechanism. The
   session lifetime contract is documented in Stripe's
   [Customer Portal guide](https://docs.stripe.com/customer-management).
6. Deploy the member owner, then the Family owner, then the sponsored-cleanup
   owner only after each predecessor is terminal. Each claim-enabled release
   depends on this cutover and may persist claims only after steps 1-5.
7. The first persisted claim makes this release the rollback floor. Roll back a
   later owner only to this revision or to a newer claim-aware revision; never
   roll back below it while a claim can exist.
8. Remove the compatibility-only assertions and columns only in a later
   contract change after all three owners are deployed, all pre-owner
   revisions and invocations are impossible, no live claim remains, and no
   supported rollback target needs these columns.

If convergence or drain cannot be proven, stop before deploying a claim writer.
Rollback of this expand release is safe only before any later release persists
a claim. After that point, recovery is a forward fix or rollback to this floor.

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
admission.
