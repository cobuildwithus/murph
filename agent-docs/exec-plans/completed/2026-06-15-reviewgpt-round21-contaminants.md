# ReviewGPT Round 21 Contaminant Fixes

## Goal

Close accepted ReviewGPT round 21 findings for PR 176.

Success criteria:

- Pure Earth source-backed product IDs use the worksheet row `r` attribute for
  stable source identity, with the previous positional row number only as a
  fallback when the attribute is absent.
- Existing open-product seed row counts and links remain unchanged unless the
  upstream source identity actually changed.
- Verification proves the generator contract and app owner lane still pass.

## Scope

- `apps/web/sql/product-tests/sync-open-product-sources.ts`
- `apps/web/test/product-tests-schema.test.ts`
- generated open-product source CSVs only if regeneration changes them

## Status

Complete.

Accepted/fixed:

- Pure Earth source IDs now preserve the worksheet row `r` attribute through
  XLSX parsing and use it for `__row_number`, with positional numbering only as
  a fallback.

Rejected:

- ReviewGPT's low-severity suggestion to make the web route the only owner of
  exact-ID/GTIN query interpretation was not accepted in this PR. Removing the
  hosted CLI fallback loop would create out-of-sync deploy risk between hosted
  runtime clients and the web data API, and is a broader API contract cleanup
  than this source-ingest fix.

Verification:

- `pnpm exec tsx apps/web/sql/product-tests/sync-open-product-sources.ts`
  wrote 8,157 source-backed product rows/tests and left committed seed CSVs
  unchanged.
- `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm docs:drift`
- `git diff --check`
- `pnpm test:diff` (passed through `apps/web verify`; same pre-existing lint
  warning and Next NFT trace warning)
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
