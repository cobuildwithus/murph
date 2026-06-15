# ReviewGPT Round 25 Food ID Lookup Fix

## Goal

Close the accepted ReviewGPT round 25 finding for PR 176.

Success criteria:

- Digit-only food `q` lookup checks exact `fdc:<digits>` IDs before UPC
  fallback.
- Explicit `?upc=` and formatted GTIN-like `q` lookup still use UPC lookup.
- GET and POST batch lookup share the same simpler exact-lookup policy.
- Focused route tests pass.

## Scope

- `apps/web/app/api/foods/route.ts`
- `apps/web/src/lib/product-labels-route.ts`
- `apps/web/test/foods-route.test.ts`

## Finding

Accepted:

- The foods route configured digit-only GTIN-length `q` lookups to try UPC
  before exact `fdc:<digits>` ID. If both a UPC match and exact FDC ID existed,
  `q=123456789012` returned the UPC product instead of the exact ID product.

## Plan

1. Remove the UPC-first override and always resolve digit-only `q` as exact ID,
   then UPC, then text search. Done.
2. Keep formatted/punctuated GTIN-like `q` values and explicit `upc` params on
   the UPC path. Done.
3. Add GET and POST regression tests for exact FDC ID winning over UPC matches.
   Done.
4. Run verification, commit, push, and rerun ReviewGPT. In progress.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/foods-route.test.ts apps/web/test/supplements-route.test.ts`:
  passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- `pnpm test:diff`: passed for affected owner `apps/web`. Existing unrelated
  warnings observed: one `getPrisma` unused lint warning in
  `apps/web/app/api/internal/hosted-mailbox/fetch/route.ts`, and the known
  Turbopack NFT trace warning.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
