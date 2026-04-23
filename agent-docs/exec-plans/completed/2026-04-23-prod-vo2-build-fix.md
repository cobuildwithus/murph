# Prod VO2 build fix

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Restore `apps/web` production builds by landing the minimal wearable query/importer typing slice required for `estimatedVo2Max` to type-check through `packages/query/src/browser-replica.ts`.

## Success criteria

- `apps/web` production build no longer fails on `summary.estimatedVo2Max`.
- The fix is scoped to the directly coupled wearable metric catalog/query types and tests.
- Relevant typecheck/build verification passes, or any remaining failure is identified as unrelated.
- A scoped commit contains only the prod-fix slice plus plan/ledger closeout.

## Scope

- In scope: `packages/importers/src/device-providers/metric-catalog.ts`, directly coupled importers tests, `packages/query/src/wearables*.ts` files, directly coupled query tests, and plan/ledger bookkeeping.
- Out of scope: VO2 biomarker content, Health Commons generated artifacts, app biomarker UI, and unrelated dirty-tree changes.

## Constraints

- Preserve overlapping in-flight VO2 biomarker work in the same files where possible.
- Do not widen the fix beyond the type/build-critical wearable metric surface.
- Keep the commit safe in the current dirty tree.

## Verification

- `pnpm --dir packages/importers test -- --runInBand test/canonical-wearables.test.ts`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/query exec vitest run test/wearables-normalized-surfaces.test.ts test/wearables-source-health-final.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir apps/web build`
- `git diff --check`

## Observed outcomes

- `pnpm --dir packages/importers test -- --runInBand test/canonical-wearables.test.ts` passed.
- `pnpm --dir packages/query typecheck` passed.
- `pnpm --dir packages/query exec vitest run test/wearables-normalized-surfaces.test.ts test/wearables-source-health-final.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir apps/web build` cleared the original `estimatedVo2Max` type failure and finished Next TypeScript successfully, then stopped later on a local environment/runtime requirement: `DATABASE_URL is required for the hosted device-sync control plane` during page-data collection for `/api/device-sync`.
- `git diff --check` passed for the scoped fix set.

## Closeout notes

- This lane intentionally stages only the wearable query/importer support needed for `estimatedVo2Max` to exist end-to-end as an activity metric.
- The later `DATABASE_URL` build stop was not part of the Vercel failure report and occurred only after the original prod-blocking type mismatch was removed.
Completed: 2026-04-23
