# Supplement Facts Image OCR Preview

## Goal

Add a dry-run-only helper that takes brand-site refetch candidates with official facts image URLs, uses vision OCR to extract structured Supplement Facts text into local artifacts, and reports which rows can become production-ready after the existing parser validates `ingredientRows` and `servingSizes`.

Success criteria:

- No supplement DB writes.
- No secret values, DB URLs, or API keys printed.
- Only official current facts image URLs from refetch preview artifacts are sent for OCR.
- OCR rows remain blocked unless the existing parser produces both `ingredientRows` and `servingSizes`.
- Global dry-run metrics show progress toward the oversized-row repair target.

## Scope

- `.agents/skills/research-supplements/scripts/*`
- `.agents/skills/research-supplements/SKILL.md`
- `scripts/supplement-db-brand-site-labels.test.ts`

## Verification

- `node --check` for edited helper scripts.
- Focused supplement Vitest.
- `pnpm typecheck`.
- Read-only OCR/refetch/dry-run preview artifacts under `/tmp`.

## Out Of Scope

- Database upserts or deletes.
- Storing full page bodies.
- Automatically promoting uncertain OCR output.
- Adding heavyweight OCR dependencies.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
