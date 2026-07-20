# PR 786 ReviewGPT Round 4 Identity-ABA Fix

## Goal

Resolve the accepted ReviewGPT finding that identity and schema demotions reset
a reviewed product-test group to generation zero, allowing an obsolete artifact
to become valid again if the source identity later returns.

Success criteria:

- `product_tests.remap_revision` remains a nondecreasing reviewed-generation
  high-watermark across source identity drift and schema demotion;
- only never-reviewed groups may use generation zero;
- old and same-generation contradictory artifacts reject after identity ABA;
- a newly reviewed higher-generation artifact applies to drifted and pristine
  equivalent databases and converges to one fingerprint;
- exact desired link-plus-generation replay remains a zero-write no-op.

## Constraints

- Keep `product_tests` as the sole persisted owner; add no history table,
  service, queue, scheduler, or reconciliation loop.
- Do not derive a new generation locally during demotion; retain the existing
  absolute group high-watermark.
- Preserve source snapshot, target fingerprint, advisory-lock, compare-and-set,
  rollback, and mixed-generation audit protections.
- Preserve unrelated worktree and coordination-ledger edits.
- Do not merge the PR without explicit user instruction.

## Working Set

- `apps/web/sql/product-tests/{schema,import-source-only-product-tests-body,import-product-test-remaps}.sql`
- `apps/web/sql/product-tests/README.md`
- focused product-test remap-safety, schema, metadata, and audit tests

## Verification Plan

- Add a direct PostgreSQL identity-ABA regression using the real source and
  remap importers through generations 1, 2, and 3.
- Cover complete replacement plus both schema demotion paths retaining the
  reviewed high-watermark.
- Run the focused product-test PostgreSQL/web suite and prepared web typecheck.
- Run required coverage review, diff/privacy checks, scoped commit, push, PR CI,
  and ReviewGPT correction verification on the exact new head.

Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
