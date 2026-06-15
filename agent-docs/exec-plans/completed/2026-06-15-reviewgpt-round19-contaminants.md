# ReviewGPT Round 19 Contaminant Fixes

## Goal

Close ReviewGPT round 19 findings for PR 176.

Success criteria:

- Destructive/convergent product and threshold seed imports fail closed when
  committed seed counts/distributions are unexpectedly truncated.
- Batch label lookup resolves exact source-qualified ids and UPC-like queries
  before falling back to generic text search.
- Focused route/import tests prove both fixes.

## Scope

- `apps/web/sql/product-tests/import-open-product-sources.sql`
- `apps/web/sql/product-tests/import-thresholds.sql`
- `apps/web/src/lib/product-labels-route.ts`
- `apps/web/test/product-tests-schema.test.ts`
- `apps/web/test/foods-route.test.ts`
- `apps/web/test/supplements-route.test.ts`

## Status

Implemented and locally verified.

Verification completed:

- `PSQL_BIN=true MURPH_LABELS_DB_URL=postgres://example.invalid/labels apps/web/sql/product-tests/import-open-product-sources.sh`
- `PSQL_BIN=true MURPH_LABELS_DB_URL=postgres://example.invalid/labels apps/web/sql/product-tests/import-thresholds.sh`
- `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-route.test.ts apps/web/test/supplements-route.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- `pnpm docs:drift`
- `git diff --check`
- `pnpm test:diff`

Known warnings:

- `apps/web lint` reports the pre-existing unrelated unused `getPrisma` import
  in `apps/web/app/api/internal/hosted-mailbox/fetch/route.ts`.
- `apps/web verify` reports the pre-existing Next build NFT trace warning from
  `apps/web/next.config.ts`.

Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
Completed: 2026-06-15
