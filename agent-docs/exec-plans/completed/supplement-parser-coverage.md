# Supplement Parser Coverage

## Goal

Improve the brand-site supplement repair preview parser so more existing rows become safe `structured_ready` dry-run candidates while preserving raw evidence for partial, ambiguous, image-only, and page-body-contaminated rows.

Success for this continuation means:

- read-only preview coverage improves from the current parser baseline;
- `structured_ready` still requires usable `label.ingredientRows` and `label.servingSizes`;
- parser broadening stays narrow and test-backed;
- no database writes happen before a reviewed dry run.

## Constraints

- Use the `research-supplements` skill contract.
- Keep one standalone supplement product/label per row.
- Do not delete raw evidence unless the preview row is production-quality structured.
- Do not expose secrets, DB URLs, local usernames, or home paths.
- Helper changes must be reusable across brands, not brand-specific import scripts.

## Plan

1. Inspect high-volume `partial_parse` patterns from the read-only preview.
2. Add narrow parser/validator support for recurring valid label shapes.
3. Add focused regression tests for each newly accepted shape and for false-positive guards.
4. Re-run syntax checks, focused tests, typecheck, and the read-only preview.
5. Review the diff for privacy/secrets and decide whether the remaining gap needs refetch/OCR or manual parsing.

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/supplement-db-brand-site-labels.test.ts --no-coverage --reporter=dot`
- `node .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `pnpm typecheck`

## Progress

- The repair preview remains read-only; no database writes were made.
- Focused parser tests cover reparsing invalid existing rows, localized serving sizes, colon-delimited facts rows, and false-positive serving-size guards.
- Latest full preview reviewed 26,116 brand-site rows and reported 15,986 `structured_ready` rows, 6,441 `partial_parse` rows, and 3,689 `needs_better_parser` rows.
- Remaining non-structured rows are dominated by missing facts/serving evidence, image/OCR/refetch candidates, page-body contamination, and ambiguous table-basis serving sizes.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
