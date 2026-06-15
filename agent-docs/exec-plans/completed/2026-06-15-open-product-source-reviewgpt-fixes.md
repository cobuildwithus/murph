# Open Product Source ReviewGPT Fixes

## Goal

Close ReviewGPT round 15 findings for PR 176's open product contaminant source
import work.

Success criteria:

- Open-source imports remain convergent without allowing partial override CSVs
  to prune complete source data accidentally.
- The generic open-source import seam keeps product identity separate from
  source result identity.
- Label lookup contaminant summaries expose bounded exact-product observations
  as well as threshold-exceedance alerts.
- Required scoped verification and ReviewGPT follow-up pass.

## Scope

- `apps/web/sql/product-tests/import-open-product-sources.*`
- `apps/web/sql/product-tests/sync-open-product-sources.ts`
- open product source seed CSVs
- `apps/web/src/lib/product-labels.ts`
- hosted data API label schema and assistant prompt text
- matching tests and docs

## Status

Implemented and locally verified.

Verification completed:

- `pnpm exec tsx apps/web/sql/product-tests/sync-open-product-sources.ts`
- `PSQL_BIN=true MURPH_LABELS_DB_URL=postgres://example.invalid/labels apps/web/sql/product-tests/import-open-product-sources.sh`
- `pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/foods-lib.test.ts apps/web/test/supplements-lib.test.ts`
- `pnpm --dir packages/cli test -- food-labels.test.ts`
- `pnpm --dir packages/assistant-engine test -- model-behavior.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm docs:drift`
- `git diff --check`
- targeted open-data display-field scan for contact-like text

Known unrelated blocker:

- `pnpm test:diff` reaches `packages/assistant-runtime typecheck` and fails on
  pre-existing `idle-maintenance.ts` nullability/source type errors.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
