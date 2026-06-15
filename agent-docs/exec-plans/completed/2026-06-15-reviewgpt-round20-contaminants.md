# ReviewGPT Round 20 Contaminant Fixes

## Goal

Close ReviewGPT round 20 findings for PR 176.

Success criteria:

- PlasticList `--replace-source` refuses destructive pruning unless the caller
  supplies and matches an expected complete product-test row count.
- Product label UPC lookup handles common GTIN-equivalent zero-padded and
  stripped variants for 8-, 12-, 13-, and leading-zero 14-digit inputs.
- Focused import and label lookup tests prove the behavior.

## Scope

- `apps/web/sql/product-tests/import-plasticlist.sh`
- `apps/web/sql/product-tests/import-plasticlist.sql`
- `apps/web/sql/product-tests/README.md`
- `apps/web/src/lib/product-labels.ts`
- `apps/web/test/product-tests-schema.test.ts`
- `apps/web/test/foods-lib.test.ts`
- `apps/web/test/supplements-lib.test.ts`
- `apps/web/test/foods-route.test.ts`
- `apps/web/test/supplements-route.test.ts`

## Status

Complete.

Review findings accepted and fixed:

- PlasticList destructive `--replace-source` now requires
  `PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS` to match the prepared
  product-test row count before any SQL runs.
- The SQL import also checks the expected row count before the destructive
  delete as defense-in-depth for direct SQL invocation.
- UPC lookup now covers GTIN-equivalent 8-, 12-, 13-, and leading-zero 14-digit
  variants.

Verification:

- `bash -n apps/web/sql/product-tests/import-plasticlist.sh`
- `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-lib.test.ts apps/web/test/supplements-lib.test.ts apps/web/test/foods-route.test.ts apps/web/test/supplements-route.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint` (passed with pre-existing unrelated hosted-mailbox
  unused import warning)
- `pnpm docs:drift`
- `git diff --check`
- `pnpm test:diff` (passed through `apps/web verify`; same pre-existing lint
  warning and Next NFT trace warning)
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
