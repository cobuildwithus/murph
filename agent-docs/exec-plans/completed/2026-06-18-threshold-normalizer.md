# Contaminant Threshold Normalizer

## Goal

Make contaminant thresholds usable without adding API-side inference:

- backfill normalized threshold triplets only for threshold rows that are already explicit product-mass concentration limits;
- clear stale normalized fields from non-comparable threshold rows;
- add a reviewed exact-product threshold application import path for scoped commodity thresholds;
- keep `/api/foods` and `/api/supplements` exact-product only.

## Constraints

- Do not infer threshold applicability from product names, brands, categories, ingredients, or source families.
- Do not add API-side raw threshold unit fallback.
- Keep source threshold rows as regulatory references unless import-time data says they are comparable.
- Use `MURPH_LABELS_DB_URL`; never print or commit database URLs.

## Decisions

- ReviewGPT recommended schema-boundary normalization instead of broad API inference.
- `contaminant_thresholds.normalized_*` remains the global comparable path for true product-mass concentration rows.
- Scoped thresholds use `product_contaminant_threshold_applications`, which links one reviewed threshold to exactly one Murph food or supplement; the API derives the comparable triplet from the current active threshold row so application rows do not carry stale threshold values.
- The reviewed threshold application TSV is authoritative; a header-only TSV can clear rows only with `--allow-empty`.

## Current State

- Implementation complete on branch `codex/threshold-applications`; ready for commit/PR.
- Existing app/data DB role can update existing threshold rows but cannot create new schema objects; actual table creation needs the normal migration/deploy role.
- Labels DB cleanup/backfill was applied through the secret-safe psql helper. It updated 0 rows because no existing product-mass concentration thresholds were stale, and there are currently 0 active global comparable threshold rows.
- Reviewed Trader Joe's beet threshold applications simulate to 2 application rows joining 4 existing exact product-test rows once the new application table is created.
- Local audit found and fixed malformed-TSV destructive-delete risk, stale denormalized threshold values in application rows, inactive-threshold imports, and supplement alias application matching against the wrong product id.

## Verification Plan

- Focused Vitest for product-test schema/import tests and label query tests.
- `pnpm --dir apps/web typecheck`.
- `pnpm test:diff` for the touched app/docs slice.
- DB simulation with the labels DB URL from local env, without printing secrets.
- Required security/privacy, coverage, and deep-review passes before PR.
- ReviewGPT PR loop after pushing the PR head.

## Verification So Far

- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/product-tests-schema.test.ts apps/web/test/foods-lib.test.ts apps/web/test/supplements-lib.test.ts`
- Passed: `pnpm --dir apps/web lint`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `git diff --check`
- Passed: `pnpm test:diff`
- Passed: security/privacy review, coverage/proof pass, and targeted deep re-review. No medium-or-higher findings remain locally.
- Full workspace `pnpm typecheck` is blocked by unrelated assistant/operator-config workspace resolution failures outside this diff.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
