# Junction history coverage reservation

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Reserve append-only compact-history coverage coordinates for every bounded
  extended-history resource introduced by the seven-PR Junction stack.

## Success criteria

- Existing v1 resource bit positions remain unchanged.
- The eight independently activated stack resources are appended to the frozen
  v1 coordinate list using exact contracts-owned names.
- Active scheduling continues to derive only from
  `JUNCTION_EXTENDED_TIMESERIES_BACKFILL_RESOURCES`.
- Tests prove the active list is a subset, the reserved union is exact, and all
  33-by-18 coordinates fit one metadata scalar under the existing limit.

## Constraints

- Do not change scheduling policy, global metadata limits, provider fetches, or
  vault retention behavior.
- Do not run ReviewGPT.

## Tasks

1. [complete] Append the reserved stack resources to the frozen v1 codec order.
2. [complete] Replace the active-list equality invariant with an active-subset invariant.
3. [complete] Update focused codec/order/size tests.
4. [complete] Run focused tests, typecheck, diff checks, commit, push, and update the PR body breakdown.

## Decisions

- The first ten positions are already persisted semantics and remain byte-for-byte
  stable. New coordinates append after `note`.
- The reserved additions are `insulin_injection`, `carbohydrates`,
  `workout_duration`, `weight`, `fat`, `body_mass_index`, `lean_body_mass`, and
  `waist_circumference`.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime.test.ts -t "Junction extended-timeseries history coverage"` (3 passed)
- `pnpm --filter @murphai/device-syncd typecheck`
- `git diff --check` and privacy scan
Completed: 2026-08-11
