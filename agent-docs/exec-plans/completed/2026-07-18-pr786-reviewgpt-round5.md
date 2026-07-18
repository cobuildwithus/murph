# PR 786 ReviewGPT Round 5 Cross-Group Generation Fix

## Goal

Resolve the accepted ReviewGPT finding that moving a stable observation between
source-product groups can lower its retained reviewed-generation fence or leave
the destination group with mixed generations.

Success criteria:

- every affected destination group uses the maximum existing absolute
  generation across destination rows and moving-row preimages;
- the destination's reviewed link is preserved while every row converges to the
  same nondecreasing generation;
- moving an observation back cannot make an obsolete artifact valid;
- a newly reviewed higher-generation artifact applies and replays with zero
  writes;
- the aggregate group-state audit remains clean.

## Constraints

- Keep `product_tests` and the existing importer transaction as the only state
  owner; add no history table, service, queue, scheduler, or reconciliation loop.
- Never increment or otherwise synthesize a generation locally; retain the
  maximum already reviewed absolute generation.
- Preserve destination link authority, source identity checks, complete-snapshot
  protection, remap compare-and-set behavior, and unrelated worktree edits.
- Do not start ReviewGPT round 6 without the explicit continuation decision
  required after the five-round cap.
- Do not merge the PR without explicit user instruction.

## Working Set

- `apps/web/sql/product-tests/import-source-only-product-tests-body.sql`
- `apps/web/sql/product-tests/README.md`
- focused product-test metadata/remap/audit tests

## Verification Plan

- Reproduce a stable observation moving from generation-2 group A into linked
  generation-1 group B and back through the real source importer.
- Prove B retains its link and every row normalizes to generation 2, the returned
  A row remains generation 2, and the old artifact rejects.
- Prove a new generation-3 artifact applies, converges, and replays without writes.
- Run the focused product-test PostgreSQL/web lane, prepared web typecheck,
  required coverage audit, diff/privacy checks, scoped commit, and PR CI.

Status: completed
Updated: 2026-07-18
Completed: 2026-07-18
