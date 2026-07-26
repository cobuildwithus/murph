# PR 964 growth review remediation

## Outcome

Resolve the two accepted final ReviewGPT findings without widening the growth
dashboard:

1. Own the fulfilled usage-top-up lifetime total in one anonymous,
   transactionally incremented aggregate that survives member deletion.
2. Compare weekly active members across equal rolling seven-day intervals.

The existing operator scorecard, billing ledger ownership, account-deletion
success path, and user-facing growth hierarchy remain unchanged.

## Evidence

- Fulfilled purchase rows are deleted by the supported account-deletion flow,
  so a live-row count cannot truthfully be labeled lifetime.
- Purchase fulfillment already has one idempotent transaction owner:
  `grantHostedUsageCreditForPurchaseTx`. Only the first successful transition
  returns `granted: true`.
- The current active-member query ends at the following UTC midnight even
  though rows exist only through render time, comparing a partial current
  period with a completed prior period.
- Production read-only aggregates show four retained fulfilled purchases.
  The migration can seed those retained facts without reading identifiers.

## Scope

- Add one unjoinable singleton growth aggregate and seed it from retained
  fulfilled purchases in the migration.
- Increment it only inside the successful purchase-fulfillment transaction.
- Read it from `/ops/growth`; account deletion documents but does not delete it.
- Give active-member growth independent `[now - 7d, now)` and
  `[now - 14d, now - 7d)` boundaries.
- Add focused unit, projection/page, privacy-retention, migration, and
  PostgreSQL transaction coverage.
- Correct the PR body’s database-read/write description.

## Invariants

- The aggregate stores no member, payer, beneficiary, purchase, Stripe, or
  event identifier and cannot be joined back to a person.
- Duplicate fulfillment, reconciliation replay, and transaction rollback do
  not increment the total.
- Member deletion never decrements the total and still removes all
  member-scoped purchase and ledger rows.
- Existing acquisition and trial calendar-day windows do not change.
- Schema evolution stays additive-first; the migration must precede the Web
  code that reads the new table.

## Verification

- Prisma generation and migration/source-shape tests.
- Focused hosted usage-credit, privacy, and growth suites.
- PostgreSQL grant/replay/rollback/deletion proof when the canonical database
  lane is available.
- Canonical `pnpm test:diff` and `pnpm verify:acceptance`.
- ReviewGPT round 2 against the correction delta.

## Completed evidence

- Prisma generation and hosted-web typecheck passed.
- Five focused suites passed with 107 tests.
- A fresh isolated PostgreSQL database applied all 122 migrations, then the
  database-backed usage-credit suite passed all 6 grant, replay, rollback, and
  deletion tests.
- Canonical `pnpm test:diff` passed in Crabbox testbox
  `tbx_01kydz24t7tn95nh5v7s5zq63s`: build, lint, typecheck, development smoke,
  511 test files, and 6,512 tests passed.
- Canonical `pnpm verify:acceptance` completed in Crabbox testbox
  `tbx_01kydz6ct6x5ew4chdtezvtz3g`: hosted Web and Cloudflare builds and tests
  passed; the sole repository failure was the unchanged CLI ReviewGPT
  prompt-contract assertion already reproduced from the base branch.
Status: completed
Updated: 2026-07-25
Completed: 2026-07-25
Completed: 2026-07-25
