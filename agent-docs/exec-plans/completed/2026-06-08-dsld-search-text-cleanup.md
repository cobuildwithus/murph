# DSLD Search Text Cleanup

## Goal

Make DSLD supplement `search_text` a compact derived search document from structured label fields, then backfill existing DSLD rows without changing raw `label` JSON.

## Scope

- `apps/web/sql/supplements/import.sql`
- `apps/web/sql/supplements/backfill-dsld-search-text.sql`
- `apps/web/test/supplements-lib.test.ts`
- `.agents/skills/research-supplements/SKILL.md`
- `.agents/skills/research-supplements/references/database-contract.md`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs`
- `scripts/supplement-db-brand-site-labels.test.ts`

## Constraints

- Preserve full raw DSLD source data in `supplements.label`.
- Preserve active ingredient names in `search_text`; keep amounts and units in raw `label` instead of duplicating them into the search index. Apply the same compact rule to future brand-site imports.
- Do not include daily value, contacts, statements, target groups, or label relationship payloads in `search_text`.
- Keep the architecture simple: one derived `search_text` field, no new search API or columns.

## Verification

- Preview old/new DSLD `search_text` sizes before writing.
- Backfill only `data_origin = 'dsld'`.
- Run focused supplement tests, app typecheck, and scoped `test:diff`.

## Outcome

- Dry-run estimated 214,780 DSLD rows, 204,956 changed rows, and an 11.27% `search_text` character reduction.
- Applied the DSLD-only backfill on 2026-06-08; 204,956 rows updated, followed by `ANALYZE supplements`.
- Post-backfill DSLD `search_text` total is 37,247,413 chars, with zero rows at the 6,000-character cap.
- Momentous Essential Multi now has a 465-character `search_text`; raw dosage remains in `label`.
- Final review found the brand-site helper still generated detail-heavy `searchText`; updated it and its tests so future brand-site imports follow the same compact product-identity plus ingredient-name rule.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
