# Product-Test `psql` Copy Variables

## Goal

Fix product-test import SQL so `psql` `\copy` commands load prepared CSV/TSV
files through the variables passed by the shell import scripts.

## Root Cause

The import SQL used SQL-literal interpolation syntax like `:'thresholds_csv'`
inside `psql` meta-commands. That syntax is appropriate in SQL statements but
does not behave as the intended filename substitution in `\copy`, causing the
live threshold import to fail before seed rows were loaded.

## Scope

- `apps/web/sql/product-tests/import-thresholds.sql`
- `apps/web/sql/product-tests/import-plasticlist.sql`
- `apps/web/sql/product-tests/import-open-product-sources.sql`
- `apps/web/test/product-tests-schema.test.ts`

## Approach

Use `FROM :variable` in each product-test `\copy` command. The shell scripts
already pass repo-relative prepared paths without spaces, so this keeps the
import path simple and avoids new quoting helpers.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm docs:drift`
- `pnpm test:diff`
- `git diff --check`
- Live labels DB threshold import through `MURPH_LABELS_DB_URL`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
