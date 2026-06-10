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

### Wave 2 — serving-size parser extensions (2026-06-09)

- Broadened `SERVING_AMOUNT`/`SERVING_FORM` patterns (approx/or-ranges, tea bags, shakes, droppers, sprays, ViaCaps, mini/soft/full/bi-layered qualifiers, translated suffixes). Converted 72 more rows to `automatedBackfillReady`; 68 (after independent stress test) dry-run-verified and upserted.

### Wave 3 — haiku LLM extraction (2026-06-09)

- Submitted 11,500 fixable-queue rows (evidence-bearing, prioritized by fewest blockers) to the Anthropic Messages Batches API on `claude-haiku-4-5`. Cost ≈ $26.90 (overran the $20 intent: 12 rows/request caused 591 of 959 requests to truncate at the 8k output cap; truncated responses still bill output tokens).
- Salvaged 9,008 complete extractions from the truncated arrays (no re-spend); 2,493 rows lost their tail and remain in the queue for a future smaller-batch resubmit.
- Validated every extraction independently (locale-aware evidence anchoring + DV cross-check, malformed-DV, directions-name, composite-amount, dup-amount, spoon-serving gates), stripped raw bloat fields, and ran the `labels.mjs` dry-run production guard. 6,893 clean → 6,888 after dropping missing-serving rows → upserted with 0 production-blocked.
- Post-write: brand_site rows with structured `ingredientRows` **7,063 → 16,029** over the session (+8,966). Total repaired upserts this session: 11,769 (4,813 + 68 + 6,888). Target of 10k structured rows exceeded.

### Wave 4 — truncated-tail resubmit (2026-06-09)

- Resubmitted the 2,493 truncated-tail rows at 6 rows/request, max_tokens 8k (≈ $9.26; these are the largest panels — prioritization had pushed multi-blocker 30+-ingredient products to the tail, so output stayed high even at 6/request). Salvaged 2,246 complete extractions; 247 genuinely oversized rows still truncate and remain queued.
- Same validated pipeline: 1,492 clean → 1,489 after dropping missing-serving → upserted, 0 production-blocked. Spot-checks correct (incl. `<1 g` bounds, "Approximately 1 Scoop (35.8g)").

### Wave 5 — validator dup-gate fix + sonnet retry (2026-06-09)

- Analysis of the ~2,457 haiku validation failures showed the largest bucket (981 dup_amount) was a false positive in the independent validator, not a model error: nutrition macros (0/1/2 g) and supplements with multiple botanicals at the same dose (e.g. 5 herbs at 100 mg) are legitimate. Fixed the gate to flag only when an amount is reused more times than it appears in evidence and the sharing rows are not macros. Recovered 920 rows for $0.
- For the genuinely-haiku-failed rows with rich evidence (mostly proprietary blends haiku flattened, plus OCR-typo names), submitted 1,052 to `claude-sonnet-4-6` at 6 rows/request. Added a Levenshtein-1 fuzzy name-anchor (only when the amount anchors) to absorb OCR corruption like "PhosphatidyIcholine". Salvaged 945; 484 passed validation and upserted, 0 production-blocked. Sonnet kept blends as faithful single rows (constituents named, blend total, no fabricated per-constituent amounts).
- Sonnet batch cost ~$11.40 (output tokens at sonnet rates are 3x haiku; collect_batches.py prints haiku-rate estimates — multiply output by 3 for sonnet).

### Session result

- Structured `brand_site` rows (non-empty `ingredientRows`): **7,063 → 18,234** (+11,171 net). Total repaired upserts: 14,662 (4,813 + 68 + 6,888 + 1,489 + 920 + 484).
- Anthropic Batches API spend: ~$47.56 of $50 (main $26.90 + tail $9.26 + sonnet $11.40; ~$2.44 left).

### Wave 6 — vision-OCR re-scrape of image-based brands (2026-06-10)

- The ~6.5k unstructured-with-url rows are image-based-facts brands (bluebonnet, carlson, codeage...) where the facts panel is a label IMAGE, not text. Pipeline: context.dev scrape (includeImages=true) → download candidate facts images locally → haiku vision SUBAGENTS (workflows, on subscription, $0 api key) read the label image natively and extract structured rows (ZERO OCR garbage — the win over the original macos-vision-OCR data) → anchor each row vs the model's own factsText readout → labels.mjs dry-run guard → upsert.
- Image SELECTION is the bottleneck, not vision. v1 (top-3 keyword) 29%; v2 (name-token match to isolate the product's own images from cross-sell + facts-filename patterns _SF/supp_facts/_back + top-5 window) ~62%, and ~95% on proven brands (carlson/codeage/doctors-best/double-wood). Sonnet vision recovered only 1/38 haiku failures → the misses are missing-data (no facts image on the page), not model-limited. Dead brands (jarrow, thorne, baidyanath, raw-nutrition, natures-plus) have front-only images → skipped.
- Scaled in pipelined 250-row batches (fetch+select → 50 haiku agents → anchor → dry-run → upsert). Through batch 10: ~1,380 OCR rows written, all anchor-verified, 0 production-blocked, 0 contamination (verified via dose-in-name vs panel match). Structured brand_site rows **18,801 → 20,084** during this wave.

### Session total (running)

- Structured `brand_site` rows: **7,063 → 20,084** (+13,021, ~2.85x). Goal was 10k.

### Remaining

- The OCR loop continues through the remaining pool (~5,576 rows minus dead brands); yield tapering into the long tail. Plus 799 non-standalone (excluded by product decision) + a residue of rows with genuine evidence defects. Front-only-image brands are unrecoverable without a different data source.

Findings:

- Repair preview runs without crashing on refetch/OCR provenance rows.
- Automated-backfill gating rejects production review issues, contaminated parsed/retained ingredient names, rows where an existing `ingredientRows` array would shrink, missing visible actives, missing visible blend constituents, CJK continuation amount tables, OCR unit shifts, and sampled food/page-body/non-standalone artifacts.
- Full preview produced 4,868 `automatedBackfillReady` candidates from 25,735 `brand_site` rows.
- Candidate dry-run found zero production-blocked rows, zero missing serving sizes, zero missing ingredient rows, zero duplicate input rows, and zero oversized search-text rows.
- Aggregate contamination scan over the regenerated candidate artifact found zero sampled suspicious ingredient-name rows and zero sampled implausible amount/unit rows.
- Seeded 100-row candidate spot checks found additional blocker gaps; those rows are now blocked or clean after normalization. No DB writes were run.
- `pnpm typecheck` currently fails outside this supplement work in `apps/web/test/hosted-execution-handoff.test.ts` because a hosted-control mock lacks `prewarmRuntime`.

Conclusion: the regenerated candidate artifact is clean for the read-only checks performed here. No supplement DB writes were run; the actual backfill remains deferred until explicit approval.
