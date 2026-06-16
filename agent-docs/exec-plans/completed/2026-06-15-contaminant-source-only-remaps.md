# Contaminant Source-Only Remaps

## Goal

Stop representing contaminant-source-only products as first-class `foods` or
`supplements` label rows. Preserve imported source facts in `product_tests`, link
only exact UPC or manually confirmed rows to real Murph product labels, and add a
local matcher/remap workflow for producing auditable `manual_confirmed` links.

## Constraints

- Keep the architecture simple: `foods` and `supplements` should remain product
  label/catalog tables, not test-source anchor tables.
- Do not fuzzy-attach contaminant evidence to catalog products at import time.
- Preserve existing source rows and attribution; unreviewed rows become
  source-only facts rather than fake label rows.
- Use `MURPH_LABELS_DB_URL` locally without printing secrets.
- No local identifiers or secrets in docs, commits, logs, or final handoff.

## Plan

1. Inventory current anchor rows and importer behavior.
2. Update `product_tests` schema to allow source-only rows and keep link checks
   fail-closed for invalid partial links.
3. Update PlasticList/open-source importers to avoid creating source-backed
   `foods`/`supplements` rows by default; only curated remaps link to real rows.
4. Add a local candidate/remap workflow for reviewable product matches.
5. Update docs/architecture and tests.
6. Re-import or dry-run against the labels DB, verify counts and links, then run
   completion workflow.

## Decisions

- Candidate matching is read-only. It exports ranked existing food/supplement
  label candidates for review; it does not automatically link tests or create
  sparse label rows from contaminant source names.
- Missing catalog products should be added through the normal food/supplement
  label ingestion path with complete label data before product-test remaps are
  applied.

## Verification

- Focused product-test schema/import and product-label helper tests passed after
  the source-only/remap changes and the defense-in-depth source-origin filter.
- Direct labels DB proof after re-import:
  - 19,886 `product_tests` rows retained.
  - PlasticList: 11,739 rows; NYC DOHMH: 6,230 rows; King County: 277 rows; Pure Earth: 1,640 rows.
  - 2,185 rows linked by 37 reviewed `manual_confirmed` PlasticList remaps.
  - 17,701 rows remain `source_only` and unlinked.
  - Bad link states: 0.
  - Legacy contaminant-source-backed `foods`/`supplements` rows: 0.
  - RXBAR PlasticList product `236` links to `fdc:705844`; product `142`
    remains `source_only` because the reviewed candidates were not defensible.
- Threshold rows are already present in the labels DB: 1,290 total, 1,283
  active, expected authority distribution, and 0 active supported product-mass
  threshold rows missing normalized fields.
- Completion audit results:
  - Security/privacy review: no medium-or-higher findings.
  - Coverage write pass: added reviewed-remap fixture proof for RXBAR `236` and
    `142`.
  - Deep review found stale legacy source-backed labels could reappear if web
    code deployed before DB cleanup; fixed with a centralized denylist applied
    to exact lookup, UPC lookup, generic search, brand-scoped search, and brand
    index loading, plus stricter remap target validation.
  - Older numeric query and threshold-normalization findings are covered by
    current route fallback tests, schema backfill, and DB proof.
- Required repo verification for touched `apps/web` SQL/script/docs surfaces is
  run before handoff.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
