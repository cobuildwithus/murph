# Supplement Brand-Site Parser Repair

## Goal

Raise the read-only repair preview quality for existing `brand_site` supplement rows by improving deterministic parsing and diagnostics, while preserving raw evidence and keeping database writes disabled until dry-run output is reviewed.

## Why

The supplement DB contains legacy brand-site rows whose saved label/search evidence may be whole page text, captions, OCR fragments, or bundle-like product text. Automated repair should only backfill rows when the saved evidence clearly represents one standalone supplement product with normalized `label.ingredientRows` and `label.servingSizes`.

## Scope

- `.agents/skills/research-supplements/SKILL.md`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.d.mts`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `scripts/supplement-db-brand-site-labels.test.ts`
- Read-only `/tmp` preview artifacts

## Constraints

- Do not write to the supplement database in this plan.
- Do not delete raw evidence from partial, uncertain, image-only, OCR-fragmented, or page-body rows.
- Treat `structured_ready` as the only automated backfill candidate class.
- Prefer narrow deterministic parser fixes over guessing from captions or marketing copy.
- Preserve unrelated working-tree edits.

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/supplement-db-brand-site-labels.test.ts --no-coverage --reporter=verbose`
- Full read-only preview command
- `pnpm typecheck`
- `git diff --check`

## Notes

Implemented deterministic parser lanes for structured facts arrays, JSON-stringified facts text, pipe-delimited facts tables, compact pipe facts rows, transposed facts tables, OCR/stacked table rows, amount/name block rows, inline terminal amount blocks, serving-size cleanup, stricter fallback gating, and parser diagnostics.

Latest read-only full preview:

- Rows reviewed: 26,116
- `structured_ready`: 11,493 after validating existing normalized rows and serving sizes
- `partial_parse`: 9,687
- `needs_better_parser`: 4,936
- Old oversized search-text rows: 279
- Proposed oversized search-text rows: 0
- Broad fallback blockers reduced to 319
- `stacked_table_continuation_risk` blockers reduced to 351
- Removable raw-field candidate rows: 1,435, all `structured_ready` with no parser blockers.
- Evidence recovery hints: 5,158 official refetch/OCR, 285 page-body refetch, 2,488 serving-size review, 6,393 parser/manual review, 299 fallback/manual review.
- Stricter existing-row validation found 5,167 rows with malformed legacy `ingredientRows` and 5,702 rows with malformed legacy `servingSizes`; these are no longer counted as `structured_ready` and raw evidence is not marked removable for them.

Parser-only repair is still insufficient for 90% because even perfecting remaining partial rows would not cover the largest `needs_better_parser` clusters. Sidecar sampling found:

- Saved text needs official refetch/OCR: Bluebonnet, Carlson, Codeage, Transparent Labs, Double Wood, Rainbow Light, NatureWise, Barlean's.
- Saved text needs official HTML refetch: Country Life.
- Saved text likely parser-fixable with a dedicated Chinese facts parser: BHK's. Implemented for 106 of 107 BHK's rows; the remaining row has serving sizes but no parseable ingredient rows in saved text.
- Do not guess from captions, page body, or marketing copy; preserve raw evidence until normalized `ingredientRows` and `servingSizes` are proven.

Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
