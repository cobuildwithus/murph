# Reduce device-reconciliation complexity

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

Reduce concentrated branching in `packages/core/src/mutations.ts` while preserving accepted inputs, outputs, diagnostics, ordering and existing ownership.

## Evidence and owner

The repository analyzer at base `56b9f3751977b5b6745269f1a444559d5ef91ce0` reports reconcileDeviceEventEntriesByExternalRef at complexity 100. The existing module remains the implementation owner. No schema, authority, state or deployment contract changes are intended.

## Approach

Inspect the implementation patch, prioritize deleted repetition and existing primitives, and use narrowly named same-file helpers only for real responsibilities. Preserve failure and retry behavior. Record both excess-over-20 debt and total complexity to distinguish factoring from branch deletion.

## Tasks

1. Inspect the proposed patch and callers; confirm behavior preservation.
2. Run focused owner tests, relevant typecheck, differential proof where useful, and the complexity guard.
3. Review the complete diff, close this plan in the scoped commit, and open a draft PR with concrete evidence.
4. Mark the stable candidate Ready; start final ReviewGPT concurrently with required exact-head CI and resolve the completion gates.

## Verification

- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts test/device-import-session.test.ts`: 191 tests passed.
- `pnpm --filter @murphai/core typecheck`: passed.

- `pnpm complexity:diff --base 56b9f3751977b5b6745269f1a444559d5ef91ce0`: passed.
- `git diff --check`: passed.
- Parent inspected the complete source and regression-test diff; no private data, new dependencies or public API changes.

## Outcome

Device reconciliation combined alias planning, revision admission and authoritative facet withdrawal. Separate those existing decisions and reuse the provider-owned retraction predicate while retaining the current ordered staging closure.

reconcileDeviceEventEntriesByExternalRef 100 → 64; file maximum 100 → 64; excess-over-20 debt delta -36; total function complexity delta +2.

The remaining reconciliation branches retain distinct identity and lifecycle decisions; further extraction would require a separate proof boundary. Remaining file hotspots: <anonymous> (27), visit (34), isExactJunctionProfileCreatedAtTimestampReplay (31), resolveJunctionFloatingFallbackTime (41), buildLegacyExternalRefReservations (24), resolveStructuralJunctionDailyAggregateAliasOwnerSplit (32), parseJunctionDailyAggregateAliasEvidence (44), analyzeJunctionDailyAggregateAliasHistoryEvolution (31), mapCurrentDeviceEventOwners (27), reconcileDeviceEventEntriesByExternalRef (64), reconcileEventImportDecisionsByExternalRef (51), dedupeDeviceEventsByExternalRef (23), importDeviceBatchWithExecutionOptions (47), preparePersistence (57), importEventBatch (22).

Final ReviewGPT and exact-head CI are tracked in the PR after this scoped commit. Internal behavior-preserving refactor; no changelog or deployment contract change.
Completed: 2026-09-14
