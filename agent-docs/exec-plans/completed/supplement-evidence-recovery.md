# Supplement Evidence Recovery

## Goal

Move brand-site supplement repair toward 90% reliable `automatedBackfillReady` coverage by making the remaining unready rows actionable for official refetch/OCR, without database writes.

Success criteria:

- Preserve the parser/backfill invariant: production-quality rows need normalized `label.ingredientRows` and `label.servingSizes`.
- Keep raw evidence for blocked, partial, weak, page-body, image-only, or uncertain rows.
- Add read-only artifacts that prioritize official refetch/OCR work by row and brand.
- Avoid brand-specific import scripts or committed scratch data.
- Do not write to the supplement database.

## Constraints

- Use the `research-supplements` skill contract.
- Existing parser-only coverage is 17,437 / 26,116 `automatedBackfillReady` rows after commit `0a7f9a397`.
- Remaining gap is mostly evidence recovery, not safe broad regex parsing.
- Do not expose secrets, DB URLs, local usernames, or home paths.

## Plan

1. Inspect current repair preview artifacts and unready bucket shape.
2. Add queue-oriented read-only artifacts for official refetch/OCR candidates.
3. Include enough row context for safe manual/subagent processing, but no raw full page bodies.
4. Run focused tests, full read-only preview, and repo verification.
5. Close this plan with a scoped commit.

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/supplement-db-brand-site-labels.test.ts --no-coverage --reporter=dot`
- `node .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm typecheck`

## Progress

- No database writes have been made.
- Added read-only evidence recovery queue artifacts to the repair preview helper.
- Latest full preview remains 26,116 rows reviewed; 17,437 `automatedBackfillReady` (66.77%); 8,679 unready rows in the recovery queue.
- Queue action buckets: 3,809 `refetch_official_label_or_ocr`, 285 `refetch_official_page_body`, 2,248 `review_serving_size_parser`, 1,840 `review_parser_or_manual`, 459 `manual_review_fallback_amount_rows`, and 38 `review_non_standalone_or_delete`.
- Top queued brands by unready row count: Bluebonnet Nutrition 565, Carlson Labs 519, Codeage 280, Country Life 276, Force Factor 214, Solaray 191, Natures Plus 190, Transparent Labs 179, Double Wood Supplements 160, Baidyanath 123.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
