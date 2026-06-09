# Brand-Site Supplement Backfill

## Goal

Prepare the safe `brand_site` supplement repair backfill by fixing the repair preview source/provenance bug and spot-checking random candidate diffs for data preservation. Do not write to the supplement DB in this pass.

Success criteria:

- Repair preview runs without crashing on refetch/OCR provenance rows.
- Only `automatedBackfillReady` candidates are considered for writes.
- A random 25-row candidate spot check confirms normalized facts are added while raw evidence, amounts, units, serving sizes, provenance, and source URLs are not lost.
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
- 25-row random candidate spot check before writes
- Candidate dry-run through `supplement-db-brand-site-labels.mjs dry-run`
- No DB write
- Current DB summary remains unchanged except for read-only inspection
- `pnpm typecheck`
- `git diff --check`

## State

Read-only fix and spot check complete; DB write deferred.

Findings:

- Repair preview now runs without crashing on refetch/OCR provenance rows.
- Automated-backfill gating now rejects production review issues, contaminated parsed/retained ingredient names, and rows where an existing `ingredientRows` array would shrink.
- Full preview produced 13,293 `automatedBackfillReady` candidates from 25,735 `brand_site` rows.
- Candidate dry-run found zero production-blocked rows, zero missing serving sizes, zero missing ingredient rows, zero duplicate input rows, and zero oversized search-text rows.
- Aggregate contamination scan over the candidate artifact found zero suspicious ingredient-name rows.
- A seeded 25-row candidate spot check found no unexpected non-structured label key removal, no source URL changes, no search-text limit violations, no missing normalized facts, and no ingredient-row decreases.

Conclusion: the regenerated candidate artifact is clean for the read-only checks performed here. No supplement DB writes were run; the actual backfill remains deferred until explicit approval.
