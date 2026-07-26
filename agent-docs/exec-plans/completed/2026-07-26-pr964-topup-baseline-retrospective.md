# PR 964 top-up baseline retrospective

Status: completed
Created: 2026-07-26
Updated: 2026-07-25

## Goal

Resolve ReviewGPT round 2's finding that the growth scorecard called a count
"lifetime" even though its migration baseline came from member-keyed purchase
rows that account deletion may already have removed.

## Retrospective decision gate

- The original requirement is one dominant weekly MRR growth rate, visibly
  green at the 10% weekly target and red below it, plus a total usage-top-up
  count and the small set of PG-style supporting growth measures.
- The first-reviewed implementation queried retained fulfilled purchase rows
  directly. Round 1 correctly identified that later account deletion could make
  the displayed total decrease.
- The current implementation added one anonymous singleton counter and a
  first-fulfillment trigger. That stabilizes future increments, but the
  migration still seeds from the same deletable rows and therefore cannot prove
  a complete pre-cutover lifetime baseline.
- Before another tactical fix, inspect existing billing/event authorities. If a
  complete deletion-independent baseline already exists, reuse it with an
  atomic cutover. Otherwise choose shrink: remove the unsupported lifetime
  claim and present the value as a tracked fulfilled-top-up total seeded from
  retained history at cutover, without adding replay, repair, or reconciliation
  machinery.
- Keep the immutable first-reviewed head
  `78ec0852c3540702cf20100cbe655c164c5c819c`; do not reset the baseline.

## Retrospective decision

- Choose shrink, not historical reconstruction. Rename the aggregate field,
  projection, scorecard, and revenue row to a **tracked fulfilled-top-up
  total**. State in the operator UI and durable docs that it starts from
  retained history at cutover, adds later first fulfillments, and may omit
  purchases deleted before tracking began.
- Keep the one anonymous singleton and trigger introduced after round 1 because
  they solve the accepted decrease-on-deletion defect with the minimum durable
  state. Do not add an external Stripe query, event classifier, replay, repair,
  or reconciliation path.
- Lock the purchase table before seeding and keep it locked until the trigger is
  installed and the migration commits. This removes the deploy cutover race
  without adding a second writer.
- Existing local webhook receipts are only opaque Stripe event pointers and
  cannot classify or deduplicate historical top-ups. A read-only live billing
  aggregate currently matches the retained production aggregate at four
  successful top-ups, which validates today's displayed value but cannot prove
  that equality through an unknown future deploy instant.
- The first-reviewed shape queried deletable purchase rows directly and made a
  complete-lifetime claim. Round 1 added one singleton, one migration trigger,
  and transaction/deletion tests. Round 2 showed that the same deletable-row
  mechanism remained in the migration baseline. This correction removes the
  unsupported requirement claim and adds only cutover locking plus one
  production-faithful migration test; it does not grow another state owner.

## Tasks

1. Prove whether an existing local, deletion-independent billing fact can
   establish the pre-cutover total.
2. Record the final requirement-level retrospective decision in this plan and
   the PR body.
3. Implement the smallest truthful contract, including an atomic migration
   cutover and regression coverage for deleted pre-cutover history, duplicate
   fulfillment, rollback, and post-cutover deletion.
4. Run focused database/UI proof, typecheck, canonical diff verification, and
   acceptance; commit and push the scoped remediation.
5. Run ReviewGPT round 3 against the exact pushed head, carrying the
   retrospective decision and both prior reviewed heads.

## Constraints

- Add no external billing query, replay path, repair job, reconciliation loop,
  member identifier, purchase identifier, event history, or timestamp history
  to the anonymous aggregate.
- Preserve account deletion and the one existing purchase-status fulfillment
  authority.
- Keep the growth page read-only.

## Verification

- Prisma generation passed.
- Focused growth, migration-shape, privacy, and migration-inventory suites
  passed: 89 tests with one environment-gated PostgreSQL test skipped.
- Hosted Web typecheck passed.
- A fresh isolated PostgreSQL database applied all 122 migrations. The focused
  migration and usage-credit database suites then passed all 9 tests, including
  deleted pre-cutover history, trigger cutover, rollback, duplicate
  fulfillment, post-cutover deletion, and the existing concurrent-grant proof.
- Canonical `pnpm test:diff` passed: 511 Web test files and 6,512 tests plus
  lint, smoke, typecheck, and production build.
- Pre-merge `pnpm verify:acceptance` passed repository typecheck, docs, and
  task-owned Web coverage before reproducing the unchanged CLI ReviewGPT prompt
  assertion already fixed on current `main`. The run was stopped after that
  known failure; acceptance will rerun after the required base merge.
Completed: 2026-07-25
