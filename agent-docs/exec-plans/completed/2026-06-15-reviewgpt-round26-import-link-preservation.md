# ReviewGPT Round 26 Import Link Preservation

## Goal

Close the accepted ReviewGPT round 26 importer finding for PR 176.

Success criteria:

- Source refreshes can prune stale source rows without overwriting curated
  product-test links.
- PlasticList conflict updates preserve existing curated/manual links unless
  the incoming row has an explicit match or the existing row is still the
  default PlasticList source-backed anchor.
- Open product source conflict updates preserve any existing curated/manual
  links instead of resetting them to source-backed anchors.
- Focused importer/schema tests pass.

## Scope

- `apps/web/sql/product-tests/import-plasticlist.sql`
- `apps/web/sql/product-tests/import-open-product-sources.sql`
- `apps/web/test/product-tests-schema.test.ts`

## Finding

Accepted:

- The importer conflict updates could overwrite `food_id`, `supplement_id`,
  and `match_method` during source refreshes. That made a complete refresh able
  to move a previously curated/manual contaminant row back to a hidden
  source-backed product if the curated match file was omitted.

## Plan

1. Remove `replace_source` as a link-overwrite reason in the PlasticList
   conflict update. Done.
2. Preserve existing open-source links unless the existing row is still the
   default source-backed `exact_source_id` anchor. Done.
3. Add structural tests that lock the preserve-or-default-update rule. Done.
4. Run verification, commit, push, and rerun ReviewGPT. In progress.

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
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
