# Whole Foods Sampler

## Goal

Build a small, non-destructive Whole Foods product sampler that tries direct HTML fetch first, extracts product/nutrition data from public product pages, and reports whether a 100-product expansion is worth a later import/legal review path.

## Constraints

- Do not write to the labels database by default.
- Do not use context.dev in the first implementation; leave direct fetch as the primary path and keep paid scraping as a later fallback decision.
- Preserve existing `foods` table shape and provenance fields.
- Keep output suitable for inspection/import prep without printing secrets or local identifiers.
- Avoid unrelated hosted runtime/onboarding edits in the main checkout.

## Plan

1. Add a script that discovers product links from Whole Foods category/search pages and fetches up to a configurable limit.
2. Parse Next.js `__NEXT_DATA__` product payloads and normalize a compact label/provenance row.
3. Emit JSON summary by default, with optional JSONL and prepared CSV outputs for review/import staging.
4. Add focused tests for extraction and CSV row generation.
5. Run focused repo-tool verification plus typecheck and a small live dry-run scenario.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/whole-foods-product-sampler.test.ts --no-coverage`
- `node --check scripts/whole-foods-product-sampler.mjs`
- `pnpm test:diff scripts/whole-foods-product-sampler.mjs scripts/whole-foods-product-sampler.d.mts scripts/whole-foods-product-sampler.test.ts agent-docs/exec-plans/active/2026-06-16-whole-foods-sampler.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm typecheck` after building missing local generated package entrypoints in this fresh worktree.
- Live dry run: `node scripts/whole-foods-product-sampler.mjs --limit 100 --delay-ms 50 --jsonl-out .fdc-work/wfm-sampler/products.jsonl --prepared-csv-out .fdc-work/wfm-sampler/prepared.csv`
  - Parsed 100 / 100 sampled products.
  - Direct fetches: 100; Context.dev fallback fetches: 0.
  - Nutrition facts coverage: 78 / 100.
  - Ingredients coverage: 76 / 100.
  - Normalized nutrients per serving: 78 / 100.
  - Estimated nutrients per 100g: 68 / 100.
- Throwaway local Postgres proof using the real `apps/web/sql/foods/schema.sql` and `apps/web/sql/foods/apply-prepared.sql` against the generated prepared CSV:
  - Inserted 100 `whole_foods_market` rows.
  - Null UPC rows: 100 / 100.
  - Rows with normalized nutrients per serving: 78 / 100.
  - Rows with estimated nutrients per 100g: 68 / 100.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
