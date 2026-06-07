# Supplement Serving Parser

## Goal

Improve the brand-site repair preview's source-aware serving-size parser for recurring directions/usage text without accepting nutrition table bases such as `100 g` or `100 ml` as serving sizes.

Success criteria:

- existing `100 g` / `100 ml` table-basis guards remain intact;
- directions/usage examples from the review produce bounded serving sizes;
- rows still require normalized `ingredientRows` and `servingSizes` before `structured_ready`;
- no database writes happen.

## Constraints

- Use the `research-supplements` skill contract.
- Keep parser changes narrow, reusable, and test-backed.
- Do not add brand-specific import scripts.
- Block obvious food/flavoring rows from automated supplement backfill.
- Keep repair-preview type declarations in sync with artifact fields.
- Preserve raw evidence for partial or uncertain rows.
- Do not expose secrets, DB URLs, local usernames, or home paths.

## Plan

1. Add source-aware serving-size extraction for usage/directions fields.
2. Cover Polish, Spanish, French, Hebrew, and structured dose-object examples where the dose is clear.
3. Keep table-basis and food/nutrition examples blocked.
4. Run syntax checks, focused tests, typecheck, and read-only preview.
5. Report remaining refetch/OCR and food/drink exclusion work before any database writes.

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/supplement-db-brand-site-labels.test.ts --no-coverage --reporter=dot`
- `node .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm typecheck`

## Progress

- Created after parser coverage checkpoint `e497c2855`.
- No database writes have been made.
- Added blocker-aware automated backfill readiness fields so `structured_ready` diagnostics cannot be mistaken for safe repair candidates.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
