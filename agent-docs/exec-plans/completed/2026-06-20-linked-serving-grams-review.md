# Linked Serving Grams Review

## Goal

Manually review every label currently linked to `product_tests` that still lacks
`serving_grams`, then fill the rows that have defensible serving-mass evidence so
daily-exposure contaminant screening works for more exact product links.

Success criteria:

- No new database tables, runtime fallback branches, or threshold-application
  machinery.
- Reviewed fixes write only to the existing `foods.serving_grams` or
  `supplements.serving_grams` columns.
- Reviewed fixes are exact-id, dry-run first, and never overwrite existing
  non-null `serving_grams`.
- Rows without defensible consumed-product mass remain unresolved with a clear
  reason instead of receiving hidden density/count assumptions.
- Local DB postflight reports linked coverage before and after apply.

## Scope

- `apps/web/sql/product-tests/backfill-serving-grams.*`
- Reviewed serving-mass seed data under `apps/web/sql/product-tests/`
- `apps/web/sql/product-tests/README.md`
- `apps/web/test/product-tests-schema.test.ts`
- Local labels DB rows for exact linked product-test labels

## Constraints

- Preserve existing data; do not delete label rows or product tests.
- Do not infer contaminants by name, brand, category, or fuzzy match.
- Keep reviewed data provenance visible and keep assumptions explicit.
- Do not expose DB URLs, secrets, raw credentials, local user identifiers, or
  home-directory paths.

## Verification

- Dry-run reviewed backfill against local labels DB before apply.
- Apply only after reviewing exact rows and expected counts.
- Post-apply linked coverage query.
- `bash -n apps/web/sql/product-tests/backfill-serving-grams.sh`
- Focused Vitest coverage for SQL/import contracts.
- `pnpm typecheck`
- `pnpm test:diff` for touched app files
- `git diff --check`

## State

DB updates applied; verification in progress.

## Done

- Confirmed linked coverage after strict backfill:
  - 77 linked food labels, 25 missing serving grams.
  - 10 linked supplement labels, 4 missing serving grams.
- Reviewed all 29 missing linked labels and added exact serving-mass evidence:
  - 25 food labels.
  - 4 supplement labels.
- Added reviewed open-product remaps for the manually confirmed NYC/King County
  links and explicit source-only resets for 11 stale numeric-collision links.
- Dry-run before apply:
  - 25 food serving-grams candidates.
  - 4 supplement serving-grams candidates.
- Applied local labels DB updates:
  - 30 reviewed open-product remap source rows.
  - 25 `foods.serving_grams` rows.
  - 4 `supplements.serving_grams` rows.
- Post-apply linked coverage:
  - 77 linked food labels, 3,990 linked food product-test rows, 0 missing
    serving grams.
  - 10 linked supplement labels, 513 linked supplement product-test rows, 0
    missing serving grams.
- Post-apply idempotency dry-run found 0 remaining serving-grams candidates.
- Security/privacy audit found no medium-or-higher findings.
- Coverage-write audit added wrapper proof for reviewed TSV path escaping,
  placeholder replacement, dry-run apply flag, and secret-safe psql invocation.
- Deep review found and fixed:
  - Trader Joe's baby beets must use serving mass, not 8 oz package mass;
    corrected local DB and reviewed TSV to 114 g.
  - Reviewed import now trims text fields after copy so padded entity types do
    not validate and then skip predicates.
  - Reviewed rows now fail if an automatic candidate would shadow them.
- Post-fix idempotency dry-run still found 0 remaining serving-grams candidates.
- Post-fix linked coverage:
  - 77 linked food labels, 3,990 linked food product-test rows, 0 missing
    serving grams.
  - 10 linked supplement labels, 513 linked supplement product-test rows, 0
    missing serving grams.

## Next

- Rerun full verification, finish-task commit, push the PR branch, then run the
  PR review loop.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
