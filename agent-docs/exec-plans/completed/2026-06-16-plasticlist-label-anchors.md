# PlasticList Label Anchors

## Goal

Import durable food/supplement label anchors for selected remaining PlasticList
source-only products, then link those PlasticList product-test rows through
reviewed remaps.

## Constraints

- Use official/current product evidence where available; use lower-confidence
  retailer/USDA evidence only when clearly marked and still product-specific.
- Do not create sparse placeholder label rows.
- Do not auto-link fuzzy matches; every remap must be manually reviewed.
- Keep conventional foods out of supplement rows.
- Use local labels DB without printing secrets.
- Preserve existing contaminant import/remap invariants.

## Requested Scope

- Emergen-C 1000mg Vitamin C Immune Support Fizzy Drink Mix Orange.
- Liquid I.V. Hydration Multiplier Electrolyte Drink Mix Strawberry.
- RXBAR 10g Protein Bar Blueberry Cashew Butter.
- Whole Foods fresh/private-label PlasticList IDs 8, 11, 12, 46, 47, 64, 65,
  135, 136, 206, 207, 209, 214, and 336.
- Trader Joe's frozen butter chicken with basmati rice before/after microwave
  PlasticList IDs 400 and 401.

## Plan

1. Research official/source evidence and existing DB coverage for requested
   products.
2. Add durable food/supplement label import rows using the smallest repo-local
   import path that preserves full label data and provenance.
3. Add reviewed PlasticList remaps for only exact reviewed anchors.
4. Import rows/remaps into the labels DB and verify every requested linked id.
5. Run focused tests/checks, completion audits, commit, push, and ReviewGPT.

## Progress

- Trader Joe's requested products identified as PlasticList IDs 400 and 401.
- Added 5 durable `brand_site` food anchors for exact reviewed Whole Foods,
  RXBAR, and Trader Joe's products.
- Added 2 durable `brand_site` supplement anchors for Emergen-C Super Orange
  and Liquid I.V. Strawberry Hydration Multiplier.
- Added reviewed remaps for 19 requested PlasticList IDs: 8 PlasticList IDs
  linked and 11 intentionally retained as `source_only`.
- DB import proof: requested IDs now cover 1,121 PlasticList `product_tests`
  rows; 380 rows link to foods, 114 rows link to supplements, 627 rows remain
  reviewed `source_only`, with 0 dual links and 0 bad unlinked rows.
- Removed the 3 prior source-variable Whole Foods fresh-produce brand-site
  anchors after remaps moved those tests back to `source_only`.
- Focused product-test schema/import-readiness test passed.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
