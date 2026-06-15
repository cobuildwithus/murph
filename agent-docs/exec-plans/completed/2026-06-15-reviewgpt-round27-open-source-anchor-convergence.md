# ReviewGPT Round 27 Open Source Anchor Convergence

## Goal

Close the accepted ReviewGPT round 27 open-source importer finding for PR 176.

Success criteria:

- Open-source reimports update importer-owned default `exact_source_id`
  anchors to the current imported product row, even if the product id or table
  changed.
- Curated/manual links remain preserved.
- A post-upsert assertion rejects any remaining imported-source
  `exact_source_id` product test that does not point at the current imported
  product row/table.
- Focused importer/schema tests pass.

## Scope

- `apps/web/sql/product-tests/import-open-product-sources.sql`
- `apps/web/test/product-tests-schema.test.ts`

## Finding

Accepted:

- The previous conflict update only refreshed links when the existing row
  already equaled the incoming source-backed product id. That preserved curated
  links, but it also preserved stale source-backed anchors if the source row was
  reclassified from food to supplement or otherwise moved to a different
  product id.

## Plan

1. Treat existing `exact_source_id` links to rows whose product `data_origin`
   equals the test `source_key` and whose `data_origin_id` equals the prior
   `tested_source_product_id` as importer-owned defaults. Done.
2. Refresh importer-owned defaults to the incoming product link on conflict;
   preserve non-default links. Done.
3. Add a post-upsert DB assertion for imported-source `exact_source_id` rows.
   Done.
4. Update structural tests and rerun verification. Done.

## Verification

- `CI=1 pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts`:
  passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- `pnpm test:diff`: passed for affected owner `apps/web`. Existing unrelated
  warnings observed: one `getPrisma` unused lint warning in
  `apps/web/app/api/internal/hosted-mailbox/fetch/route.ts`, and the known
  Turbopack NFT trace warning.
- Sidecar subagent review agreed the default-anchor invariant should be
  provenance-based: same linked product `data_origin` and prior
  `tested_source_product_id`, not old target equals incoming target.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
