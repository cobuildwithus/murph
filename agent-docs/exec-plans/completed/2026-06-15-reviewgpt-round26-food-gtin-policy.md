# ReviewGPT Round 26 Food GTIN Query Policy

## Goal

Close the ReviewGPT round 26 food lookup policy finding without making the
shared label resolver ambiguous.

Success criteria:

- Bare GTIN-shaped food `q` values prefer UPC lookup before prefixed FDC ID
  lookup.
- Explicit `id=...` and `q=fdc:<id>` remain exact ID-first.
- Supplements keep the default exact-ID-first behavior for bare numeric
  queries.
- GET and POST batch lookup tests cover the policy.

## Scope

- `apps/web/app/api/foods/route.ts`
- `apps/web/src/lib/product-labels-route.ts`
- `apps/web/test/foods-route.test.ts`

## Finding

Accepted:

- A bare digit-only 8/12/13/14-character food `q` value is normally a UPC/GTIN
  search. The route had been changed to check `fdc:<digits>` first, which could
  return an unrelated FDC row when a scanned UPC collides with an FDC ID.

## Plan

1. Add an explicit route option for bare GTIN-shaped query priority. Done.
2. Configure foods to prefer UPC for bare GTIN-shaped `q` values. Done.
3. Update GET and POST regressions to cover UPC-first bare `q` and ID-first
   explicit `fdc:<id>`. Done.
4. Run verification, commit, push, and rerun ReviewGPT. In progress.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/foods-route.test.ts apps/web/test/supplements-route.test.ts apps/web/test/product-tests-schema.test.ts`:
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
