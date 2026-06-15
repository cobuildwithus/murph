# ReviewGPT Round 23 Contaminant Fixes

## Goal

Close accepted ReviewGPT round 23 findings for PR 176.

Success criteria:

- Product contaminant threshold comparisons do not conflate regulatory scope
  with measurement basis.
- Threshold rows can carry normalized comparison fields independently from their
  regulatory scope.
- Existing public seed rows remain non-comparable when their scope is a legal,
  commodity, daily-exposure, water, or leaching-solution scope rather than an
  explicit product-mass scope.
- Explicit product-mass-scoped threshold rows can compare against normalized
  product-test concentrations.
- `GET ?q=` product label lookups resolve exact source-qualified product IDs
  and UPC/GTIN values the same way POST batch lookup does.
- CLI hosted label searches delegate all exact-id/UPC semantics to the Worker
  search route instead of duplicating lookup rules.
- Duplicate active normalized threshold keys fail with an explicit migration or
  import error before a unique-index failure.
- Focused tests and the normal affected-owner verification lane pass.

## Scope

- `apps/web/src/lib/product-labels.ts`
- `apps/web/src/lib/product-labels-route.ts`
- `apps/web/sql/product-tests/schema.sql`
- `apps/web/sql/product-tests/import-thresholds.sql`
- `apps/web/sql/product-tests/README.md`
- `packages/cli/src/hosted-data-api-labels.ts`
- `packages/cli/src/food-labels.ts`
- focused CLI hosted-label tests
- focused product label route and product-test schema tests

## Findings

Accepted:

- Threshold rows currently store legal/applicability scope in
  `threshold_basis`, but summary loading joins that field to
  `product_tests.normalized_basis`, which is a measurement basis. Real seeded
  thresholds therefore often fail to match real normalized observations.
- GET `q=` calls generic text search directly, while POST uses the exact
  ID/UPC-first helper. Source-backed contaminant rows hidden from text search
  can therefore be retrievable by POST but not by equivalent GET search.
- Normalizing product-mass `ng/g`/`ppb` rows to `ppm` can collapse multiple
  active threshold rows onto the same comparable key. The migration/import path
  needs a clear preflight error rather than an opaque unique-index failure.
- Additive threshold imports must compare incoming normalized keys against
  already-active comparable rows that will remain after the import, not just
  against duplicates inside the incoming CSV.
- The CLI hosted-label client had a second copy of exact ID/UPC fallback logic,
  which could drift from the Worker route.

## Plan

1. Add explicit normalized threshold comparison fields while keeping
   `threshold_basis` as regulatory scope. Done.
2. Normalize only explicitly product-mass-scoped concentration threshold units
   into the threshold normalized triplet. Done.
3. Join product tests to thresholds through the normalized triplet and compare
   against normalized threshold values. Done.
4. Reuse the exact lookup helper for GET `q=`. Done.
5. Add focused tests covering real seed-threshold normalization and GET exact
   lookup parity. Done.
6. Simplify the CLI hosted-label client to a single Worker `q` request and move
   exact/fallback proof to web route tests. Done.
7. Add duplicate active normalized-threshold preflight checks to schema and
   threshold import SQL, including additive-import collisions against existing
   active rows. Done.
8. Run verification, completion audits as needed, commit, push, and rerun
   ReviewGPT. In progress.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-route.test.ts apps/web/test/supplements-route.test.ts apps/web/test/supplements-lib.test.ts`:
  passed.
- `pnpm --dir packages/cli test -- packages/cli/test/food-labels.test.ts packages/cli/test/supplement-labels.test.ts packages/cli/test/food-save-typed-parity.test.ts packages/cli/test/supplement-wearables-coverage.test.ts`:
  passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir packages/cli typecheck`: passed.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- `pnpm test:diff`: passed for affected owners `apps/web` and `packages/cli`.
  Existing unrelated warnings observed: one `getPrisma` unused lint warning in
  `apps/web/app/api/internal/hosted-mailbox/fetch/route.ts`, and the known
  Turbopack NFT trace warning.
- Coverage/proof subagent rerun against the active worktree: no findings; no
  edits.
- Deep-review subagent rerun against the active worktree: accepted additive
  import duplicate-preflight gap, fixed, then narrow re-review found no
  actionable issue.
- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-route.test.ts apps/web/test/supplements-route.test.ts apps/web/test/supplements-lib.test.ts`
  after the additive import preflight fix: passed.
- `git diff --check` after the additive import preflight fix: passed.
- Final `pnpm docs:drift`: passed.
- Final `pnpm test:diff`: passed for affected owners `apps/web` and
  `packages/cli`; same unrelated warnings as above.
- Final `git diff --check`: passed.
- Privacy sweep: no local user/home-path identifiers in changed files; only
  existing fake route-test bearer tokens and fake redaction-test DB secret
  strings matched secret-like patterns.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
