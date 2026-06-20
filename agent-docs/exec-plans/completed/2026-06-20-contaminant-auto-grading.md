# Contaminant Auto Grading

## Goal

Make product contaminant grading automatic for imported label-linked tests: a product with an exact `product_tests` row should be graded from normalized contaminant measurements, product serving mass when needed, and broadly applicable threshold guidance, without manual per-product threshold application rows.

Success means:

- `product_contaminant_threshold_applications` and the reviewed-application import path are removed.
- Runtime contaminant summaries grade exact product tests directly against compatible `contaminant_thresholds` rows.
- Daily body-weight guidance, such as BPA TDI, can grade from concentration plus serving grams through one explicit app policy.
- Missing serving mass or incompatible guidance yields `unknown`, not a false low/safe grade.
- RXBAR BPA grades automatically from PlasticList product `236` linked to `fdc:705844` when serving grams are present.

## Constraints

- Default to deletion and radical simplicity.
- Keep exact product-test linking as the trust boundary; do not infer contaminants from names, brands, ingredients, categories, or fuzzy matches.
- Do not add a new table unless a failing test proves the simpler model cannot work.
- Keep assumptions visible in returned details, not hidden in one-off threshold seeds.
- Preserve unrelated working-tree edits.

## Plan

1. Map current schema, import, runtime, and test references.
2. Add the smallest durable fields needed for automatic grading.
3. Replace product-specific threshold joins with direct test-plus-guidance scoring.
4. Delete application import scripts, seeds, postflight, schema objects, and tests.
5. Dry-run against the local labels DB and run required verification/audits.

## Verification

- Focused contaminant schema/runtime tests.
- Web typecheck or diff-aware verification as required.
- Local DB dry-run proving RXBAR BPA grades from imported data without application rows.

## Current State

- Removed the manual threshold application schema/import path and replaced it
  with direct threshold scoring from exact linked `product_tests`.
- Added `serving_grams` to food/supplement labels and imports.
- Added committed EFSA BPA screening guidance and runtime one-serving/day adult
  exposure scoring.
- Threshold imports now replace the curated screening set and legacy scoped
  threshold rows are deactivated during migration, preventing stale legal
  snapshot rows from silently grading products.
- Reviewed remaps backfill serving mass for newly linked labels so future exact
  product links become scoreable immediately when label grams are present.
- Bounded runtime threshold selection to one ranked threshold per product-test
  row and capped returned observation details.
- Local labels DB dry run imports the screening threshold with no application
  table and proves RXBAR product `236` linked to `fdc:705844` has 52 g serving
  mass and 0.0022 ppm BPA, yielding 1.634286 ng/kg_bw/day for a 70 kg adult, or
  8.171429x the one-serving/day adult BPA screen.
- Verification passed: focused contaminant/runtime/import tests, full prepared
  web test suite, web prepared typecheck, CLI food-label test, shell syntax,
  `git diff --check`, and scoped secret/local-identifier scan.
- CLI package typecheck is still blocked by broad existing workspace resolution
  failures for assistant/operator-config packages, not this contaminant patch.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
