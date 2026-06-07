# Supplement Refetch Preview

## Goal

Add a reusable dry-run helper for supplement brand-site recovery rows that refetches official product evidence without writing to the supplement database.

Success criteria:

- The helper reads the existing repair preview recovery queue and emits bounded evidence candidates only.
- Shopify product pages are supported through official product JSON when available.
- Variant matching, facts-image selection, and non-standalone/product-shape gating are covered by focused tests.
- The skill docs point future runs at the helper and preserve the invariant that production rows need `label.ingredientRows` and `label.servingSizes`.
- No database write path is added or invoked.

## Context

The repair preview currently identifies thousands of rows where saved evidence is missing, image-only, or contaminated by full page bodies. Many high-volume brands expose current official evidence through product JSON and label media rather than saved facts text. The next durable primitive is an official refetch preview that gathers one-product/one-variant evidence and keeps blocked rows out of production until normalized facts are present.

## Scope

- `.agents/skills/research-supplements/SKILL.md`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs`
- `.agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.d.mts`
- `scripts/supplement-db-brand-site-labels.test.ts`

## Verification

- `node --check .agents/skills/research-supplements/scripts/supplement-db-brand-site-refetch-preview.mjs`
- Focused Vitest coverage for pure helper functions.
- `pnpm typecheck`

## Out Of Scope

- Writing or deleting supplement DB rows.
- Guessing normalized facts from marketing copy.
- Committing downloaded HTML, images, OCR output, or product-page bodies.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
