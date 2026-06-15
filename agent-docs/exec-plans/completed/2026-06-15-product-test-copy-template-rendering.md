# Product-Test Copy Template Rendering

## Goal

Make live product-test imports load prepared CSV/TSV files through `psql`
`\copy` without relying on psql variable interpolation inside meta-commands.

## Root Cause

The labels DB import run showed that `\copy ... FROM :variable` and
`\copy ... FROM :'variable'` are treated as literal filenames by this psql
client. The earlier SQL-only fix therefore still failed before threshold rows
were loaded.

## Scope

- `apps/web/sql/product-tests/labels-db-psql.sh`
- `apps/web/sql/product-tests/import-thresholds.sh`
- `apps/web/sql/product-tests/import-plasticlist.sh`
- `apps/web/sql/product-tests/import-open-product-sources.sh`
- `apps/web/sql/product-tests/import-thresholds.sql`
- `apps/web/sql/product-tests/import-plasticlist.sql`
- `apps/web/sql/product-tests/import-open-product-sources.sql`
- `apps/web/test/product-tests-schema.test.ts`

## Approach

Keep each import in one psql session by rendering the import SQL into the run
work directory with one escaped literal filename per `\copy` placeholder. The
prepared paths are repo-relative run-work paths, so the rendered SQL does not
expose source env values or absolute local paths.

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
