# Threshold Single-File Prune Guard

## Goal

Close ReviewGPT round 18's threshold-import data integrity finding.

Success criteria:

- Default all-seed threshold imports stay convergent and can deactivate missing
  active rows for authorities represented by the committed seed set.
- Single-file/custom threshold imports upsert contained rows without
  deactivating unrelated active thresholds for the same authority.
- Docs and focused tests describe and prove the safer default.

## Scope

- `apps/web/sql/product-tests/import-thresholds.sh`
- `apps/web/sql/product-tests/import-thresholds.sql`
- `apps/web/sql/product-tests/README.md`
- `apps/web/test/product-tests-schema.test.ts`

## Status

Implemented and locally verified.

Verification completed:

- `bash -n apps/web/sql/product-tests/import-thresholds.sh`
- `PSQL_BIN=true MURPH_LABELS_DB_URL=postgres://example.invalid/labels apps/web/sql/product-tests/import-thresholds.sh`
- `CONTAMINANT_THRESHOLDS_CSV_PATH=apps/web/sql/product-tests/thresholds/eu_contaminant_thresholds.csv PSQL_BIN=true MURPH_LABELS_DB_URL=postgres://example.invalid/labels apps/web/sql/product-tests/import-thresholds.sh`
- `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm docs:drift`
- `git diff --check`

Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
Completed: 2026-06-15
