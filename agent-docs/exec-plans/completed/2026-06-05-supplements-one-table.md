# Supplements One-Table Hard Cut

## Goal

Collapse the hosted supplement label lookup schema from two tables into one `supplements` table while preserving label provenance, deduped search, exact lookup, UPC lookup, batch search, and hosted runner API-key interception.

## Constraints

- Keep the table named `supplements`.
- Treat this as a hard cut; no dual-read compatibility layer.
- Do not expose secrets or local env values.
- Keep the architecture simple: one table, one query surface, no product graph.
- Preserve `/api/supplements` and CLI command behavior unless a field name must become clearer.

## Working Set

- `apps/web/sql/supplements/schema.sql`
- `apps/web/sql/supplements/import.sql`
- `apps/web/sql/supplements/import-dailymed.sql`
- `apps/web/src/lib/supplements.ts`
- `apps/web/test/supplements-lib.test.ts`
- `apps/web/test/supplements-route.test.ts`
- `packages/cli/src/supplement-labels.ts`
- `packages/cli/test/supplement-labels.test.ts`
- `packages/cli/test/supplement-wearables-coverage.test.ts`
- `ARCHITECTURE.md`

## Plan

1. Replace the SQL schema/imports with the one-table `supplements` shape.
2. Refactor `apps/web/src/lib/supplements.ts` to remove table unions and query one table.
3. Update focused tests to assert the one-table query shape and renamed provenance fields.
4. Update architecture docs for the new single-table boundary.
5. Copy the final DB cleanup SQL that drops legacy backup tables and normalizes brand-site origins.
6. Run focused app/CLI tests plus typecheck and diff-aware verification.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/supplements-lib.test.ts apps/web/test/supplements-route.test.ts` (2 files, 21 tests)
- Passed: `pnpm exec vitest run packages/cli/test/supplement-labels.test.ts packages/cli/test/supplement-wearables-coverage.test.ts` (2 files, 19 tests)
- Passed: `git diff --check`
- Passed: `pnpm typecheck`
  - Note: command exited 0 while still printing the pre-existing workspace-boundary warning for `apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts`.
- Passed: `bash scripts/workspace-verify.sh test:diff ARCHITECTURE.md agent-docs/exec-plans/active/2026-06-05-supplements-one-table.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md apps/web/sql/supplements/schema.sql apps/web/sql/supplements/import.sql apps/web/sql/supplements/import-dailymed.sql apps/web/src/lib/supplements.ts apps/web/test/supplements-lib.test.ts apps/web/test/supplements-route.test.ts packages/cli/src/supplement-labels.ts packages/cli/test/supplement-labels.test.ts packages/cli/test/supplement-wearables-coverage.test.ts`
  - Covered `packages/cli` typecheck/test and `apps/web verify`.
  - Note: command exited 0 while still printing the same pre-existing workspace-boundary warning, plus existing hosted-web lint/build warnings unrelated to this diff.
- After simplify review fixes, reran and passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/supplements-lib.test.ts apps/web/test/supplements-route.test.ts` (2 files, 21 tests)
  - `pnpm exec vitest run packages/cli/test/supplement-labels.test.ts packages/cli/test/supplement-wearables-coverage.test.ts` (2 files, 19 tests)
  - `git diff --check`
  - `pnpm typecheck`
    - Note: command exited 0 while still printing the same pre-existing workspace-boundary warning.
- After coverage review added a schema-locking test, reran and passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/supplements-lib.test.ts apps/web/test/supplements-route.test.ts` (2 files, 22 tests)
  - `git diff --check`
  - `pnpm typecheck`
    - Note: command exited 0 while still printing the same pre-existing workspace-boundary warning.
  - `bash scripts/workspace-verify.sh test:diff ARCHITECTURE.md agent-docs/exec-plans/active/2026-06-05-supplements-one-table.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md apps/web/sql/supplements/schema.sql apps/web/sql/supplements/import.sql apps/web/sql/supplements/import-dailymed.sql apps/web/src/lib/supplements.ts apps/web/test/supplements-lib.test.ts apps/web/test/supplements-route.test.ts packages/cli/src/supplement-labels.ts packages/cli/test/supplement-labels.test.ts packages/cli/test/supplement-wearables-coverage.test.ts`
    - Covered `packages/cli` typecheck/test and full `apps/web verify`.
    - Note: command exited 0 while still printing the same pre-existing workspace-boundary warning, plus existing hosted-web lint/build warnings unrelated to this diff.
- After coverage-write retry proof, added one schema readback test and reran:
  - Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/supplements-lib.test.ts apps/web/test/supplements-route.test.ts` (2 files, 22 tests)
  - Passed: `git diff --check`
  - Passed: `pnpm typecheck`
    - Note: command exited 0 while still printing the same pre-existing workspace-boundary warning.

## Audit Notes

- Security/privacy review: no critical/high/medium findings. Residual availability-only deployment concern: new DB shape and new web code must be cut over together; Cloudflare route/key-injection shape is unchanged.
- Simplify review: accepted two low-severity simplifications.
  - Removed redundant `(data_origin, data_origin_id)` index from `schema.sql`; the unique constraint already creates a btree index.
  - Simplified CLI detail parsing so Zod strips the `label` field instead of using a custom detail extension/destructure.
- Coverage-write review: accepted one test-only gap fix in `apps/web/test/supplements-lib.test.ts` to lock `schema.sql` to the one-table shape, the unique provenance constraint, the canonical-key index, and no legacy table/redundant origin index.
- Deep review: no actionable production bugs. Residuals are expected/documented: batch POST is text-search only, future brand-site imports must keep `data_origin='brand_site'`, and old web code is incompatible with the new DB shape.
- Coverage-write retry: accepted one small proof gap and added a schema readback test covering one-table schema, required provenance uniqueness, canonical-key index, no legacy external table, and no redundant origin index.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
