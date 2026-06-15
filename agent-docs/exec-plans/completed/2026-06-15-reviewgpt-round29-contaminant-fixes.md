# ReviewGPT Round 29 Contaminant Fixes

## Goal

Resolve accepted ReviewGPT round 29 findings for PR 176:

- Pure Earth source-backed ids must not depend on physical XLSX row position.
- Numeric upper-bound results (`lt`/`lte`) should provide clean evidence only
  when the upper bound is at or below a comparable threshold.

## Scope

- `apps/web/sql/product-tests/sync-open-product-sources.ts`
- `apps/web/sql/product-tests/open-data/open_product_sources_products.csv`
- `apps/web/sql/product-tests/open-data/open_product_sources_product_tests.csv`
- `apps/web/sql/product-tests/import-plasticlist.sh`
- `apps/web/src/lib/product-labels.ts`
- `apps/web/test/product-tests-schema.test.ts`
- `apps/web/test/supplements-lib.test.ts`

## Approach

- Use Pure Earth `Item ID` as the stable exact source id and fail if an eligible
  numeric food row lacks it. The committed seed uniqueness guards then prove the
  natural keys stay unique.
- Normalize numeric `lt`/`lte` values when a numeric bound exists; leave
  `not_detected` rows without LOQ/upper bound unknown.
- Include `lt`/`lte` rows in threshold lookup and classify upper-bound rows as
  non-alert comparable evidence only when the bound is at or below threshold.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`
- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/supplements-lib.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm docs:drift`
- `pnpm test:diff`
- `git diff --check`
- Re-import open product sources and PlasticList into the labels DB, then verify
  product-test link integrity.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
