# Serving Grams Strict Backfill

## Goal

Backfill `serving_grams` for food and supplement label rows using only deterministic gram evidence, so contaminant daily-serving screens can compare more linked product tests without manual per-product rows.

Success criteria:

- Existing non-null `serving_grams` values are never overwritten by the repair path.
- The backfill uses only explicit mass evidence in grams or exact FDC gram portions, not volume or count proxies.
- The repair path is dry-run by default and requires an explicit apply flag to write.
- Import/schema repair paths share the same strict evidence rules where practical.
- Focused tests cover the parser rules, safety bounds, and dry-run helper.
- A dry run reports candidate counts before any apply recommendation.

## Scope

- `apps/web/sql/product-tests/backfill-serving-grams.*`
- `apps/web/sql/product-tests/schema.sql`
- `apps/web/sql/product-tests/import-product-test-remaps.sql`
- `apps/web/sql/foods/apply-prepared.sql`
- `apps/web/sql/foods/import-fdc.sql`
- `apps/web/sql/supplements/import.sql`
- `apps/web/sql/supplements/import-dailymed.sql`
- `apps/web/test/product-tests-schema.test.ts`

## Constraints

- Preserve current data: no deletes, no broad rewrite, no overwrite of non-null `serving_grams`.
- Do not treat volume as mass in `serving_grams`; `ml`, `MLT`, `fl oz`, cup, bottle, tablet, capsule, and softgel remain unfilled unless an explicit gram value exists.
- Keep the implementation SQL-level and visible. Do not add a stored function, view, queue, or application service for this one-time repair.
- Candidate values must be positive and bounded to a plausible serving mass.
- Do not expose DB URLs, secrets, raw credentials, local user identifiers, or local home paths.

## Verification

- `bash -n apps/web/sql/product-tests/backfill-serving-grams.sh`
- Focused Vitest coverage for product-test SQL contracts.
- Dry-run against the local labels DB before apply.
- If apply is approved, run the dry-run again after apply and confirm zero remaining candidates for strict rules.
- `pnpm typecheck` or a documented scoped-verification fallback if unrelated app failures block it.
- `git diff --check`

## State

Implementation complete; final review/commit in progress.

## Done

- Added strict dry-run/apply serving-grams backfill for foods and supplements.
- Backfilled labels DB with explicit apply:
  - foods updated: 1,710,438
  - supplements updated: 28,415
- Post-apply strict dry-run reports zero remaining strict candidates.
- RXBAR `fdc:705844` has `serving_grams = 52.0`.
- Tightened follow-up review findings:
  - import upserts fill missing serving masses without overwriting existing non-null values
  - branded FDC portion fallback requires exact household-serving text match
  - count/container portion descriptions are rejected alongside volume descriptions
  - supplement repair paths no longer parse free-text gram substrings
  - prepared food imports null out out-of-range serving masses before upsert
- Read-only audit for now-rejected existing patterns found:
  - food ambiguous portion non-null rows: 0, linked product tests: 0
  - supplement text-only non-null rows: 431, linked product tests: 0
  - existing unlinked supplement values were left unchanged to avoid unreviewed data deletion.
- Verification passed:
  - `bash -n apps/web/sql/product-tests/backfill-serving-grams.sh`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/product-tests-schema.test.ts`
  - `pnpm typecheck`
  - `pnpm test:diff apps/web/sql/product-tests/backfill-serving-grams.sql apps/web/sql/product-tests/backfill-serving-grams.sh apps/web/sql/product-tests/schema.sql apps/web/sql/product-tests/import-product-test-remaps.sql apps/web/sql/foods/import-fdc.sql apps/web/sql/foods/apply-prepared.sql apps/web/sql/supplements/import.sql apps/web/sql/supplements/import-dailymed.sql apps/web/test/product-tests-schema.test.ts`
  - `git diff --check`

## Next

- Resolve final follow-up review output.
- Close plan with `scripts/finish-task`.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
