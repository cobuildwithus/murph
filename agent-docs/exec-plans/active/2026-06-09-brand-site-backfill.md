# Brand-Site Supplement Backfill

## Goal

Prepare the safe `brand_site` supplement repair backfill by fixing the repair preview source/provenance bug and spot-checking random candidate diffs for data preservation. Do not write to the supplement DB in this pass.

Success criteria:

- Repair preview runs without crashing on refetch/OCR provenance rows.
- Only `automatedBackfillReady` candidates are considered for writes.
- Seeded random 100-row candidate spot checks confirm normalized facts are added while raw evidence, amounts, units, serving sizes, provenance, and source URLs are not lost.
- Existing `brand_site` candidate rows are proven through preview plus dry-run only.
- DB write remains deferred until the user explicitly approves it after spot-check results.

## Scope

- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `scripts/supplement-db-brand-site-labels.test.ts`
- Read-only `/tmp` repair preview artifacts
- Read-only inspection of supplement DB `supplements` rows with `data_origin = 'brand_site'` and repair-preview `automatedBackfillReady = true`

## Constraints

- Preserve raw label evidence unless the repair preview explicitly marks raw evidence fields removable for a production-quality candidate.
- Do not write blocked, partial, ambiguous, image-only, OCR-fragmented, page-body, food/snack, or non-standalone rows.
- Do not write any supplement DB rows in this pass.
- Do not expose DB URLs, secrets, raw credentials, local paths, or direct personal identifiers.
- Keep architecture simple: fix the existing source/provenance seam; do not add a new search API or alternate storage shape.

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- Focused supplement helper tests
- Full repair preview
- 100-row random candidate spot check before writes
- Candidate dry-run through `supplement-db-brand-site-labels.mjs dry-run`
- No DB write
- Current DB summary remains unchanged except for read-only inspection
- `pnpm typecheck`
- `git diff --check`

## State

Backfill written: 4,813 `brand_site` rows upserted with user approval on 2026-06-09.

Write-pass summary:

- An independent stress test of the 4,868-candidate artifact (exact-token evidence anchoring under both decimal locales, FDA daily-value cross-checks, name-contamination scans) surfaced ~30 hard defects: evidence-inherited unit shifts (e.g. Chromium 200 mg where 571% DV proves 200 mcg), daily values stored as fractions instead of percent strings, directions/FAQ text as ingredient names, one OCR-mangled fraction serving ("14 Teaspoon"), and composite slash amounts.
- Five production gates were added to the repair preview with regression tests: `daily_value_unit_mismatch`, `malformed_daily_value`, `directions_like_ingredient_name`, `composite_amount_value`, `implausible_spoon_serving_size`.
- Regenerated preview: 4,868 → 4,817 `automatedBackfillReady` (51 evicted by the new gates; all other parser statuses unchanged). Independent re-test of the new artifact showed zero rows in any gated defect class.
- Four residual rows flagged by the independent checker (one toxic-dose unit shift with no DV to cross-check, two buried concatenated/duplicate rows, one translated-name row) were excluded from the write batch; 4,813 rows were dry-run-verified (0 production-blocked, 0 duplicates, 0 oversized search text) and upserted.
- Post-write verification: brand_site row count unchanged at 25,735 (updates only); rows with structured `ingredientRows` 7,063 → 11,259; average `search_text` length 1,541 → 1,443.

Findings:

- Repair preview runs without crashing on refetch/OCR provenance rows.
- Automated-backfill gating rejects production review issues, contaminated parsed/retained ingredient names, rows where an existing `ingredientRows` array would shrink, missing visible actives, missing visible blend constituents, CJK continuation amount tables, OCR unit shifts, and sampled food/page-body/non-standalone artifacts.
- Full preview produced 4,868 `automatedBackfillReady` candidates from 25,735 `brand_site` rows.
- Candidate dry-run found zero production-blocked rows, zero missing serving sizes, zero missing ingredient rows, zero duplicate input rows, and zero oversized search-text rows.
- Aggregate contamination scan over the regenerated candidate artifact found zero sampled suspicious ingredient-name rows and zero sampled implausible amount/unit rows.
- Seeded 100-row candidate spot checks found additional blocker gaps; those rows are now blocked or clean after normalization. No DB writes were run.
- `pnpm typecheck` currently fails outside this supplement work in `apps/web/test/hosted-execution-handoff.test.ts` because a hosted-control mock lacks `prewarmRuntime`.

Conclusion: the regenerated candidate artifact is clean for the read-only checks performed here. No supplement DB writes were run; the actual backfill remains deferred until explicit approval.
