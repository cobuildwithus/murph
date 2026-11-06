# Reduce commons-catalog complexity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Reduce concentrated branching in `packages/health-commons/src/catalog.ts` while preserving accepted inputs, outputs, diagnostics, ordering and existing ownership.

## Evidence and owner

The repository analyzer at base `56b9f3751977b5b6745269f1a444559d5ef91ce0` reports validateHealthCommonsContent at complexity 70. The existing module remains the implementation owner. No schema, authority, state or deployment contract changes are intended.

## Approach

Inspect the implementation patch, prioritize deleted repetition and existing primitives, and use narrowly named same-file helpers only for real responsibilities. Preserve failure and retry behavior. Record both excess-over-20 debt and total complexity to distinguish factoring from branch deletion.

## Tasks

1. Inspect the proposed patch and callers; confirm behavior preservation.
2. Run focused owner tests, relevant typecheck, differential proof where useful, and the complexity guard.
3. Review the complete diff, close this plan in the scoped commit, and open a draft PR with concrete evidence.
4. Mark the stable candidate Ready; start final ReviewGPT concurrently with required exact-head CI and resolve the completion gates.

## Verification

- `pnpm --dir packages/health-commons exec vitest run --config vitest.config.ts --no-coverage test/catalog-coverage.test.ts test/catalog.test.ts`: 29 tests passed.
- `pnpm --dir packages/health-commons typecheck`: passed.

- `pnpm complexity:diff --base 56b9f3751977b5b6745269f1a444559d5ef91ce0`: passed.
- `git diff --check`: passed.
- Parent inspected the complete source and regression-test diff; no private data, new dependencies or public API changes.

## Outcome

Commons content validation combined page indexing and every reference family in one large function. Separate those responsibilities while preserving index-before-reference ordering and completing each page before advancing.

validateHealthCommonsContent 70 → 11; file maximum 70 → 27; excess-over-20 debt delta -50; total function complexity delta +6.

The changed responsibility now fits below the threshold; unchanged neighboring policies remain separately scoped. Remaining file hotspots: collectSourceIdentityKeys (21), collectSourceIdentifierFields (27).

Final ReviewGPT and exact-head CI are tracked in the PR after this scoped commit. Internal behavior-preserving refactor; no changelog or deployment contract change.
Completed: 2026-09-14
