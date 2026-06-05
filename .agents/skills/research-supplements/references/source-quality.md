# Source Quality

## Evidence Tiers

1. **Official current label evidence**: brand product pages, official Supplement Facts/Nutrition Facts images, official PDFs, Shopify product feeds plus page label text.
2. **Official but partial evidence**: product description, variant list, ingredient section without full facts panel.
3. **Non-official evidence**: retailers, review pages, search snippets, images from third parties. Use only as a lead or mark lower-confidence.

Production upserts should use tier 1 evidence whenever possible. Tier 2 rows must set `needsManualReview: true` unless the missing fields are irrelevant. Tier 3 rows should not overwrite official rows without explicit user approval.

## Extraction Rules

- Capture the date/time fetched in `label.sourceFetchedAt`.
- Keep raw facts text, ingredient text, and source URL even when you also create structured ingredients.
- Prefer variant-specific rows when flavors differ.
- If a page provides multiple flavor facts, map each variant to the facts text mentioning that flavor and keep `allProductFactsText` for audit.
- If OCR is required, record the image URL and mark the OCR as extracted text, not official page text.
- Do not infer amounts, serving sizes, or inactive ingredients from marketing copy.
- Do not treat bundles/stacks as standalone supplement formulas unless the row clearly represents a bundled product and is marked as a stack.

## Momentous Rehearsal Notes

The Momentous official Shopify feed at `https://www.livemomentous.com/products.json?limit=250` returned a current product roster with product handles, variants, SKUs, tags, and product descriptions.

Issues found:

- The feed includes merch, shakers, test products, topical PR Lotion products, bundles, and stacks. These need classification before import.
- Product page image alt text often contains high-quality Supplement Facts or Nutrition Facts text.
- Multi-flavor pages may include all flavor facts on one page. Variant rows should prefer facts text that mentions the variant and keep all page facts for audit.
- Some products had no parseable facts text in the HTML and need manual follow-up or OCR.
- Repeated full-page fetches can trigger HTTP 429. Use delay/backoff and retry focused handles instead of hammering the site.
- The DB already had some Momentous DSLD rows. Exact UPC matching is enough to set a brand-site row's `canonical_key` to the matched `dsld:<id>` row when the current UPC is already present in `supplements`.
- The one-table schema uses `data_origin = 'brand_site'` for official brand pages. Do not write per-brand origins such as `momentous`; use `data_origin_id = momentous:<sourceId>` instead.
