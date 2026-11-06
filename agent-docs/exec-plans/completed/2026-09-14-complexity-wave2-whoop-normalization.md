# Reduce whoop-normalization complexity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Reduce concentrated branching in `packages/importers/src/device-providers/whoop.ts` while preserving accepted inputs, outputs, diagnostics, ordering and existing ownership.

## Evidence and owner

The repository analyzer at base `56b9f3751977b5b6745269f1a444559d5ef91ce0` reports normalizeWhoopSnapshot at complexity 69. The existing module remains the implementation owner. No schema, authority, state or deployment contract changes are intended.

## Approach

Inspect the implementation patch, prioritize deleted repetition and existing primitives, and use narrowly named same-file helpers only for real responsibilities. Preserve failure and retry behavior. Record both excess-over-20 debt and total complexity to distinguish factoring from branch deletion.

## Tasks

1. Inspect the proposed patch and callers; confirm behavior preservation.
2. Run focused owner tests, relevant typecheck, differential proof where useful, and the complexity guard.
3. Review the complete diff, close this plan in the scoped commit, and open a draft PR with concrete evidence.
4. Mark the stable candidate Ready; start final ReviewGPT concurrently with required exact-head CI and resolve the completion gates.

## Verification

- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers.test.ts`: 73 tests passed.
- `pnpm --filter @murphai/importers typecheck`: passed.
- Focused `test/device-providers/deletion-normalization.test.ts`: passed.
- `pnpm complexity:diff --base 56b9f3751977b5b6745269f1a444559d5ef91ce0`: passed.
- `git diff --check`: passed.
- Parent inspected the complete source and regression-test diff; no private data, new dependencies or public API changes.

## Outcome

WHOOP snapshot normalization contained all sleep, recovery, cycle and workout emission logic inline. Move each record family into a private emitter and share the existing identity expression, retaining event order and fallback IDs.

normalizeWhoopSnapshot 69 → 17; file maximum 69 → 17; excess-over-20 debt delta -49; total function complexity delta +0.

The changed responsibility now fits below the threshold; unchanged neighboring policies remain separately scoped. No functions above 20 remain in this source file.

Final ReviewGPT and exact-head CI are tracked in the PR after this scoped commit. Internal behavior-preserving refactor; no changelog or deployment contract change.
Completed: 2026-09-14
