# ReviewGPT Round 28 Contaminant Import Fixes

## Goal

Close the accepted ReviewGPT round 28 findings for PR 176.

Success criteria:

- PlasticList `--replace-source` makes prepared link targets authoritative,
  while default reruns still preserve existing curated links.
- `product_tests` rows cannot be silently deleted by cascading food/supplement
  label deletes.
- Threshold CSV preparation handles valid CSV files without trailing newlines
  without undercounting rows or concatenating files.
- Focused tests and required verification pass.

## Scope

- `apps/web/sql/product-tests/import-plasticlist.sql`
- `apps/web/sql/product-tests/import-thresholds.sh`
- `apps/web/sql/product-tests/schema.sql`
- `apps/web/sql/product-tests/README.md`
- `apps/web/test/product-tests-schema.test.ts`

## Findings

Accepted:

1. PlasticList `--replace-source` docs say the prepared input is authoritative,
   but the SQL preserved stale curated links when a match row was omitted.
2. `product_tests` foreign keys used `ON DELETE CASCADE`, allowing product
   label deletes to silently remove source evidence.
3. Threshold import preparation used `wc -l` plus `tail`, which is brittle for
   CSV files missing a trailing newline.

## Plan

1. Add `replace_source` back only as a `--replace-source` conflict-link
   overwrite reason. Done.
2. Replace product-test foreign-key cascades with restrictive/default
   foreign-key behavior, including idempotent constraint repair for existing
   deployments. Done.
3. Replace threshold seed copying/counting with a single `awk` loop that skips
   the header and emits one newline per copied data row. Done.
4. Update docs/tests, verify, commit, push, then use `.env.local` to verify or
   import the labels DB. In progress.

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
