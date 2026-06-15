# ReviewGPT Round 24 Alert Unit Fix

## Goal

Close the accepted ReviewGPT round 24 finding for PR 176.

Success criteria:

- Product contaminant alert `result` and `threshold` triplets use the same
  normalized comparison value/unit/basis.
- Raw product-test evidence remains available through `observations`.
- Focused web and CLI tests pass.

## Scope

- `apps/web/src/lib/product-labels.ts`
- `apps/web/test/supplements-lib.test.ts`
- `packages/cli/test/food-labels.test.ts`

## Finding

Accepted:

- Alert rows compared normalized result values against normalized threshold
  values but emitted the raw threshold triplet. The API could therefore return
  an alert such as `0.012 ppm` versus `10 ng/g`, even though the actual
  comparison was `0.012 ppm` versus `0.01 ppm`.

## Plan

1. Emit alert threshold value/unit/basis from the normalized threshold triplet.
   Done.
2. Remove unused raw threshold triplet selection from the product contaminant
   summary query. Done.
3. Update focused tests and fixtures to assert normalized alert thresholds.
   Done.
4. Run verification, commit, push, and rerun ReviewGPT. In progress.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/supplements-lib.test.ts apps/web/test/foods-route.test.ts apps/web/test/supplements-route.test.ts apps/web/test/product-tests-schema.test.ts`:
  passed.
- `pnpm --dir packages/cli test -- packages/cli/test/food-labels.test.ts packages/cli/test/supplement-labels.test.ts`:
  passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir packages/cli typecheck`: passed.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- `pnpm test:diff`: passed for affected owners `apps/web` and `packages/cli`.
  Existing unrelated warnings observed: one `getPrisma` unused lint warning in
  `apps/web/app/api/internal/hosted-mailbox/fetch/route.ts`, and the known
  Turbopack NFT trace warning.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
