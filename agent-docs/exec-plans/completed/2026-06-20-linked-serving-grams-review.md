# Linked Serving Grams Review

## Goal

Manually review every label currently linked to `product_tests` that still lacks
`serving_grams`, then fill the rows that have defensible serving-mass evidence so
daily-exposure contaminant screening works for more exact product links.

Success criteria:

- No new database tables, runtime fallback branches, or threshold-application
  machinery.
- Reviewed fixes write only to the existing `foods.serving_grams` or
  `supplements.serving_grams` columns.
- Automatic parsed fixes fill only null `serving_grams`; reviewed fixes are
  exact-id rows that may correct stale values for that exact label.
- Rows without defensible consumed-product mass remain unresolved with a clear
  reason instead of receiving hidden density/count assumptions.
- Local DB postflight reports linked coverage before and after apply.

## Scope

- `apps/web/sql/product-tests/backfill-serving-grams.*`
- `apps/web/sql/product-tests/apply-reviewed-serving-grams.sql`
- Reviewed serving-mass seed data under `apps/web/sql/product-tests/`
- Label source import scripts that can refresh `serving_grams`
- `apps/web/sql/product-tests/README.md`
- `apps/web/test/product-tests-schema.test.ts`
- Local labels DB rows for exact linked product-test labels

## Constraints

- Preserve existing data; do not delete label rows or product tests.
- Do not infer contaminants by name, brand, category, or fuzzy match.
- Keep reviewed data provenance visible and keep assumptions explicit.
- Do not expose DB URLs, secrets, raw credentials, local user identifiers, or
  home-directory paths.

## Verification

- Dry-run reviewed backfill against local labels DB before apply.
- Apply only after reviewing exact rows and expected counts.
- Post-apply linked coverage query.
- `bash -n apps/web/sql/product-tests/backfill-serving-grams.sh`
- Focused Vitest coverage for SQL/import contracts.
- `pnpm typecheck`
- `pnpm test:diff` for touched app files
- `git diff --check`

## State

DB updates applied; PR follow-up verification passed through round 2. Round 3
fix in progress: source refreshes must automatically reapply exact reviewed
serving masses.

## Done

- Confirmed linked coverage after strict backfill:
  - 77 linked food labels, 25 missing serving grams.
  - 10 linked supplement labels, 4 missing serving grams.
- Reviewed all 29 missing linked labels and added exact serving-mass evidence:
  - 25 food labels.
  - 4 supplement labels.
- Added reviewed open-product remaps for the manually confirmed NYC/King County
  links and explicit source-only resets for 11 stale numeric-collision links.
- Dry-run before apply:
  - 25 food serving-grams candidates.
  - 4 supplement serving-grams candidates.
- Applied local labels DB updates:
  - 30 reviewed open-product remap source rows.
  - 25 `foods.serving_grams` rows.
  - 4 `supplements.serving_grams` rows.
- Post-apply linked coverage:
  - 77 linked food labels, 3,990 linked food product-test rows, 0 missing
    serving grams.
  - 10 linked supplement labels, 513 linked supplement product-test rows, 0
    missing serving grams.
- Post-apply idempotency dry-run found 0 remaining serving-grams candidates.
- Security/privacy audit found no medium-or-higher findings.
- Coverage-write audit added wrapper proof for reviewed TSV path escaping,
  placeholder replacement, dry-run apply flag, and secret-safe psql invocation.
- Deep review found and fixed:
  - Trader Joe's baby beets must use serving mass, not 8 oz package mass;
    corrected local DB and reviewed TSV to 114 g.
  - Reviewed import now trims text fields after copy so padded entity types do
    not validate and then skip predicates.
  - Reviewed rows now fail if an automatic candidate would shadow them.
- Post-fix idempotency dry-run still found 0 remaining serving-grams candidates.
- Post-fix linked coverage:
  - 77 linked food labels, 3,990 linked food product-test rows, 0 missing
    serving grams.
  - 10 linked supplement labels, 513 linked supplement product-test rows, 0
    missing serving grams.
- ReviewGPT round 1 found stale source-import serving masses could survive a
  refreshed source label. Fixed source import conflict handlers so refreshed
  non-null `EXCLUDED.serving_grams` wins over stored `serving_grams`.
- ReviewGPT round 1 also recommended simplifying serving-mass repair ownership.
  Kept source-import gram extraction at source import boundaries, removed
  duplicated serving-mass repair blocks from product-test schema/remap imports,
  and made `backfill-serving-grams.sql` the only linked product-test repair path.
- Follow-up dry-run after simplification:
  - 29 reviewed serving-mass rows loaded.
  - 0 candidate rows to apply.
  - Rolled back.
- Follow-up linked coverage:
  - 77 linked food labels, 3,990 linked food product-test rows, 0 missing or
    invalid serving grams.
  - 10 linked supplement labels, 513 linked supplement product-test rows, 0
    missing or invalid serving grams.
- Rollback source-refresh proof showed a stale 56 g food row updated to 60 g
  when refreshed source import data supplied 60 g.
- Verification passed:
  - shell syntax check for product-test backfill/remap wrappers.
  - reviewed TSV field-count checks.
  - focused `product-tests-schema.test.ts`.
  - `pnpm typecheck`.
  - `pnpm test:diff` for touched files, with the existing Next NFT warning.
  - `git diff --check`.
- ReviewGPT round 2 found canonical supplement aliases could use the selected
  alias serving mass instead of the linked product-test label's serving mass.
  Fixed runtime contaminant lookup so `linked_labels` carries `serving_grams`
  and daily-exposure scoring uses that linked label value.
- ReviewGPT round 2 found the round 1 source-import fix was still
  non-convergent when a refreshed source no longer supplied serving grams.
  Superseded it with two explicit owners:
  - current source imports set `serving_grams = EXCLUDED.serving_grams`, so a
    refreshed null clears stale source-derived mass.
  - reviewed exact-ID backfill rows update when the stored value differs from
    the reviewed value, while automatic parsed candidates still only fill nulls.
- Round 2 rollback proofs:
  - stale 56 g source-derived value cleared to null when refreshed source import
    supplied null.
  - reviewed `tj:072774` override corrected a simulated stale 227 g value back
    to 114 g.
- Round 2 linked coverage remained:
  - 77 linked food labels, 3,990 linked food product-test rows, 0 missing or
    invalid serving grams.
  - 10 linked supplement labels, 513 linked supplement product-test rows, 0
    missing or invalid serving grams.
- Round 2 verification passed:
  - shell syntax check for product-test backfill/remap wrappers.
  - reviewed TSV field-count checks.
  - focused `product-tests-schema.test.ts` and `supplements-lib.test.ts`.
  - `pnpm typecheck`.
  - `pnpm test:diff` for touched files, with the existing Next NFT warning.
  - `git diff --check`.
- ReviewGPT round 3 found routine label refreshes could clear exact reviewed
  serving masses because source imports now converge to the current source
  snapshot, including nulls. Added one transient reviewed overlay SQL step and
  wired it as the final writer after FDC, prepared-food, DSLD, and DailyMed
  imports. The overlay reads `reviewed-serving-grams.tsv`, validates rows, and
  updates only existing exact `foods`/`supplements` ids whose value differs.

## Next

- Prove the round 3 overlay with rollback DB checks, run verification, commit,
  push, and run the next PR review loop.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
