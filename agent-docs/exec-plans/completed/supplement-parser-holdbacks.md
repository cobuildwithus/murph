# Supplement Parser Holdbacks

## Goal

Fix the remaining brand-site supplement parser holdbacks without losing raw evidence. Success means the helper either produces clean single-product `ingredientRows` plus `servingSizes`, or blocks rows with malformed/partial parse output before production upsert.

## Scope

- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-ocr-preview.mjs`
- `scripts/supplement-db-brand-site-labels.test.ts`
- Local dry-run artifacts under `/tmp/murph-supplement-audit`

## Constraints

- Do not delete or overwrite the 71 held-back DB rows until dry-run output proves clean structured facts.
- Do not store full page bodies in production candidates.
- Production candidates must be standalone products with `label.ingredientRows` and `label.servingSizes`.
- Preserve official source provenance.

## Verification

- Focused supplement parser tests.
- `node --check` on changed `.mjs` helpers.
- `pnpm typecheck`.
- Read-only repair/refetch/OCR dry-runs for the held-back rows.

## State

- Approved 182-row DB upsert completed and read back clean: no page-body rows, oversized search text, missing ingredient rows, or missing serving sizes in that batch.
- Remaining oversized repair preview after parser fixes: 97 rows; 47 direct repair candidates mechanically dry-run clean but remain review-only here because the approval was for the 182-row write and the legacy New Chapter set still needs metadata sanity review.
- Refetch/OCR recovery for the blocked queue: 50 rows reviewed, 30 official facts-image rows OCRed, 21 OCR candidates pass production dry-run, 29 remain manual/needs better official evidence.
- No additional DB writes after the approved 182-row upsert.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
