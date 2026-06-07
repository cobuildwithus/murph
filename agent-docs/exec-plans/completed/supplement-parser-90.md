# Supplement Parser 90

## Goal

Move brand-site supplement repair readiness toward 90% with reliable normalized `ingredientRows` and `servingSizes`.

Success criteria:

- Increase blocker-free `automatedBackfillReady` coverage materially from the current 16,733 / 26,116 baseline.
- Prefer broad, source-aware parser improvements over brand-specific scripts.
- Preserve raw evidence for partial, uncertain, page-body, image-only, or weak rows.
- Keep the `research-supplements` skill aligned with the blocker-aware `automatedBackfillReady` gate.
- Do not write to the database.

## Constraints

- Use the `research-supplements` skill contract.
- Production-quality rows require both normalized `ingredientRows` and `servingSizes`.
- Do not add brand-specific import helpers to the committed skill.
- Refetch/OCR candidates must remain dry-run/review artifacts unless explicitly approved for DB writes.
- Do not expose secrets, DB URLs, local usernames, or home paths.

## Plan

1. Sample the highest-volume unready brands and classify their saved evidence.
2. Add only safe parser improvements that generalize across sources.
3. Keep blocker-aware automated readiness separate from diagnostic parser status.
4. Run the read-only repair preview after each meaningful parser change.
5. Report remaining gap to 90% with evidence if parser-only work cannot reach it.

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/supplement-db-brand-site-labels.test.ts --no-coverage --reporter=dot`
- `node .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm typecheck`

## Progress

- Baseline after commit `9b3cc9b04`: 26,116 rows reviewed; 16,733 `automatedBackfillReady`; 6,772 additional rows needed for 90%.
- No database writes have been made.
- Added parser improvements for official serving-column volume rows, `Vegan` serving forms, Polish `STOSOWANIE` dose sections, `fl. oz.` serving sizes, and `EACH SERVING PROVIDES` OCR blocks.
- Added source-aware serving fixes for German serving directions (`servingDirectionsText`, `Verzehrempfehlung`, `Tablette`/`Kapsel`) and Czech official serving columns (`tablety`, `láhev`, singular `sáček` with gram amount).
- Latest read-only full preview: 26,116 rows reviewed; 17,437 `automatedBackfillReady` (66.77%); 23,505 needed for 90%, leaving 6,068 additional rows.
- Remaining unready rows are mostly evidence recovery rather than safe parser-only fixes: 3,809 `official_refetch_or_ocr`, 2,248 `parser_serving_size_review`, 1,840 `parser_or_manual_review`, 459 `manual_review_fallback_rows`, and 285 `official_refetch_page_body`.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
