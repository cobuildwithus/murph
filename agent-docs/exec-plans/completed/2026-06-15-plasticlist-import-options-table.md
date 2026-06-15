# PlasticList Import Options Table

## Goal

Make the live PlasticList import commit after copying prepared rows by avoiding
psql variable references inside dollar-quoted PL/pgSQL blocks.

## Root Cause

The live labels DB import copied the prepared PlasticList files, then failed
before commit because `:'replace_source'` and
`:'replace_source_expected_product_test_rows'` were inside a dollar-quoted `DO`
block. psql does not interpolate variables inside dollar-quoted strings.

## Scope

- `apps/web/sql/product-tests/import-plasticlist.sql`
- `apps/web/test/product-tests-schema.test.ts`

## Approach

Materialize `replace_source` and the expected product-test count into a one-row
temp table outside PL/pgSQL, then read that table from the `DO`, delete, and
conflict-update clauses. Keep the shell interface unchanged.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm docs:drift`
- `pnpm test:diff`
- `git diff --check`
- Live labels DB PlasticList import through `MURPH_LABELS_DB_URL`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
