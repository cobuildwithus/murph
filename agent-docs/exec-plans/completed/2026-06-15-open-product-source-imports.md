# Open Product Contaminant Source Imports

## Goal

Extend the exact-product contaminant import path with open, row-level,
displayable source data beyond PlasticList.

Success criteria:

- Import only public/open-use product-test rows that attach to exactly one
  Murph `foods` or `supplements` row by source identity.
- Keep source-backed rows hidden from generic text search while exact ids still
  resolve.
- Preserve source license/attribution and per-row source URLs.
- Keep the implementation small: generator, committed CSV seeds, importer, and
  focused tests.
- Run verification plus the PR ReviewGPT loop to no accepted major findings.

## Scope

Allowed sources for this pass:

- NYC DOHMH consumer-product metals open data.
- King County consumer-product lead open data.
- Pure Earth RMS Zenodo dataset.

Excluded for this pass:

- Paywalled, unclear-license, or "trust us" product tables.
- Recall feeds without numeric product contaminant measurements.
- Category, brand-only, fuzzy, or probable product evidence.
- Non-food/non-supplement categories such as cookware, cosmetics, toys, paint,
  and household items. Source-defined ingestible remedy categories may map to
  `supplements` when the source does not split remedies from dietary
  supplements.

## Implementation Notes

- Source-backed rows are stable FK anchors, not user-facing generic search hits.
- Every committed `product_tests` row must have exactly one linked product row
  in the same prepared import.
- Pure Earth row ids include the workbook row number because item ids are not
  globally unique.
- Actual database import requires `MURPH_LABELS_DB_URL`; local verification can
  prove the import path through fake `psql` without exposing credentials.
- Imported committed seed counts: 8,157 source-backed products and 8,157
  exact-linked product tests, split across NYC DOHMH (6,230), King County
  (277), and Pure Earth (1,650).
- Generic search hides source-backed contaminant-only rows, including
  supplement brand-scoped search and brand-index loading; exact source-qualified
  ids still resolve.
- Re-imports are convergent for the source keys present in the prepared CSVs:
  stale product tests are deleted, and source-backed products without remaining
  tests are removed.

## Verification Plan

- Regenerate the open-source CSVs from upstream sources.
- Run shell syntax and fake-`psql` importer dry runs.
- Run focused `apps/web` product-test/label tests.
- Run `apps/web` typecheck and the diff-aware repo lane where practical.
- Run required completion audits, then commit/push and run ReviewGPT on the PR.

## Status

Implemented and locally verified. Live database import remains blocked until a
real `MURPH_LABELS_DB_URL` is available in the target environment.

Verification completed:

- `pnpm exec tsx apps/web/sql/product-tests/sync-open-product-sources.ts`
- `bash -n apps/web/sql/product-tests/import-open-product-sources.sh`
- `PSQL_BIN=true MURPH_LABELS_DB_URL=postgres://example.invalid/labels apps/web/sql/product-tests/import-open-product-sources.sh`
- `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-lib.test.ts apps/web/test/supplements-lib.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- `pnpm test:diff`
- `pnpm docs:drift`
- targeted open-data display-field scan for contact-like text
- local security/privacy, coverage/proof, and final deep-review audit passes

Known unrelated blocker:

- Root `pnpm typecheck` still fails in
  `packages/assistant-runtime/src/hosted-runtime/idle-maintenance.ts` on
  pre-existing nullability/source type errors.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
