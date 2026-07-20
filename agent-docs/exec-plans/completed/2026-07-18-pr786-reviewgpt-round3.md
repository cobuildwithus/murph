# PR 786 ReviewGPT Round 3 Portability Fix

## Goal

Resolve the accepted ReviewGPT finding that locally incremented product-test
remap revisions make reviewed artifacts diverge across equivalent databases.

Success criteria:

- reviewed artifacts own an absolute positive decision generation;
- equivalent source snapshots converge regardless of migration or import order;
- current latest-state artifacts bootstrap pristine source-only generation-zero
  rows directly;
- stale, same-generation contradictory, source-drifted, and link-ABA artifacts
  fail closed;
- reviewed source-only decisions and later observations inherit one generation;
- exact desired link-plus-generation replay writes zero rows.

## Constraints

- Keep `product_tests` as the sole persisted owner; add no history table,
  service, queue, scheduler, or reconciliation loop.
- Preserve source snapshot, target fingerprint, advisory-lock, row compare-and-set,
  transaction rollback, and source-import identity-drift protections.
- Preserve unrelated worktree and coordination-ledger edits.
- Do not merge the PR without explicit user instruction.

## Working Set

- `apps/web/sql/product-tests/{schema,import-source-only-product-tests-body,import-product-test-remaps,export-product-test-match-candidates,audit-product-tests}.sql`
- `apps/web/sql/product-tests/{import-product-test-remaps.sh,build-product-test-remap-review.ts,README.md}`
- `apps/web/sql/product-tests/remaps/{plasticlist-reviewed,open-product-reviewed}.tsv`
- focused product-test schema, metadata, remap-safety, and audit tests

## Verification Plan

- Focused PostgreSQL remap and source-import tests, including independently
  constructed legacy, fresh, and pristine schemas plus a second correction.
- Full touched product-test test set and hosted-web prepared typecheck.
- Aggregate product-test integrity audit and exact artifact dry-run/replay proof
  against an isolated local labels fixture.
- Privacy, diff, worktree, and PR-head checks.
- Push the correction head, start ReviewGPT concurrently with PR CI, and continue
  until the exact head has green checks and zero accepted findings.
Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
