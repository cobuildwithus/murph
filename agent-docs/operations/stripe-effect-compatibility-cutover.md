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
4. Deploy the member owner, then the Family owner, then the sponsored-cleanup
   owner only after each predecessor is terminal. Each claim-enabled release
   depends on this cutover and may persist claims only after steps 1-3.
5. The first persisted claim makes this release the rollback floor. Roll back a
   later owner only to this revision or to a newer claim-aware revision; never
   roll back below it while a claim can exist.
6. Remove the compatibility-only assertions and columns only in a later
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
member row, start an independent current-revision writer, prove PostgreSQL
reports that writer waiting on the row lock, then commit the claim. Direct
customer creation, Family capacity, owner relationship authority, and owner
and beneficiary account deletion must all reject retryably without a provider
request or partial suspension.
