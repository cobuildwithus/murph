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

Read-only spot check complete; DB write deferred.

Findings:

- Repair preview now runs without crashing on refetch/OCR provenance rows.
- Full preview produced 17,086 `automatedBackfillReady` candidates from 25,735 `brand_site` rows.
- Candidate dry-run found 97 production-blocked rows with `non_standalone_product`; the raw candidate artifact is not directly writable.
- A seeded 25-row spot check of production-unblocked candidates found no unexpected non-structured label key removal, no source URL changes, no search-text limit violations, and no missing normalized facts.
- The same spot check found two quality-risk rows where a larger malformed existing `ingredientRows` array would be replaced by fewer parsed rows that still include table header/directions text.
- Aggregate scan found 564 production-unblocked candidate rows with suspicious parsed ingredient names containing table header/directions markers such as `% NRV`, `Zusammensetzung`, or `WARTOŚCI ODŻYWCZE`.

Conclusion: do not write the current candidate artifact as-is. Next step is to tighten automated-backfill gating or parser cleanup for those suspicious parsed rows, regenerate candidates, and spot-check again before any DB write.
