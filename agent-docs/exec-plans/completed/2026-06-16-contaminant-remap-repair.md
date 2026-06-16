# Contaminant Remap Repair

## Goal

Link a small additional batch of high-confidence source-only contaminant product
groups to existing real Murph label rows, and add a conservative local helper
for producing a manual review queue without automatic contaminant attachment.

## Constraints

- Do not fuzzy-attach contaminant evidence automatically.
- Only add reviewed remaps where source name/brand and catalog label identity
  are defensible from the candidate context.
- Preserve `source_only` for ambiguous commodity, private-label, or nearby-name
  candidates.
- Keep the helper read-only with respect to the database and remap TSV unless a
  human explicitly edits/imports the reviewed TSV.
- Use the labels DB locally without printing secrets.

## Plan

1. Inspect remaining source-only source-product groups and candidate rankings.
2. Add a small batch of reviewed remaps to the committed PlasticList remap TSV.
3. Add a conservative review-queue helper if it removes manual sorting work
   without creating product links.
4. Import the updated remaps into the labels DB and verify link counts.
5. Run focused tests/checks, commit, push, and run the required PR review loop
   if the PR head changes.

## Verification

- Remap TSV import-readiness tests.
- DB proof for updated linked/source-only counts.
- Focused product-test SQL/script tests and relevant typecheck/syntax checks.

## Progress

- Added 15 reviewed PlasticList remaps: Celsius Wild Berry, Celsius Kiwi Guava,
  Nature Made Prenatal Folic Acid + DHA, five Fairlife/Core Power shake
  variants, Red Bull original, Athletic Greens AG1, Annie's Organic Classic
  Cheddar Mac & Cheese, Kraft Mac & Cheese before/after microwave, RXBAR
  Strawberry, and Cheerios.
- Added a read-only review-queue helper:
  `apps/web/sql/product-tests/build-product-test-remap-review.ts`.
- Rejected a broader trigram candidate-export fallback after a read-only
  PlasticList export stayed too slow for routine use.
- Labels DB remap import proof:
  - `manual_confirmed=3040`
  - `source_only=16846`
  - `food_links=2641`
  - `supplement_links=399`
  - `bad_link_state=0`
  - PlasticList reviewed source products: `52/3040`
  - PlasticList source-only source products: `184/8699`
  - Legacy contaminant-source-backed labels: `foods=0`, `supplements=0`
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
