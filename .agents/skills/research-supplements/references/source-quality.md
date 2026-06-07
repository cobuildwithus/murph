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
- If static fetches cannot reach official label evidence, use Computer Use with Safari only for read-only official-page inspection: product pages, image galleries, tabs, label/PDF viewers, official downloads, and visible label text.
- Do not use Safari to log in, create accounts, add to cart, purchase, submit forms, solve CAPTCHAs, bypass browser/security/paywall barriers, change settings, upload/transmit user data, or treat retailer facts as authoritative.
- If a page provides multiple flavor facts, map each variant to the facts text mentioning that flavor and keep the full raw facts evidence for audit.
- If OCR is required, record the image URL and mark the OCR as extracted text, not official page text.
- Do not infer amounts, serving sizes, or inactive ingredients from marketing copy.
- Do not treat bundles/stacks as standalone supplement formulas. Import only one standalone supplement product/label per row.
- Do not treat conventional foods as supplement formulas. Reject snack-category products, protein/nutrition/energy bars, ready-to-eat foods, ready-to-drink shakes or beverages, cookies, brownies, chips/crisps, candy-like foods, meal bars, and grocery-style food products even when they expose Nutrition Facts. Report them as skipped or delete candidates.
