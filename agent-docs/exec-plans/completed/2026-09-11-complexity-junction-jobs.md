# Simplify Junction resource job execution

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Reduce the branching burden in Junction resource execution while preserving its current import, source-authority, retry, and continuation behavior.

## Success criteria

- The resource dispatcher exposes distinct companion, calendar, temporal, direct-inline, and timeseries phases.
- Existing provider-shaped regressions and device-syncd typecheck pass.
- The cyclomatic guard passes with lower changed-file debt and maximum complexity.

## Scope

- In scope: private resource-job helpers inside the existing Junction provider factory.
- Out of scope: full-job scheduling, hydration, new policy, new persistence, and concurrent temporal-efficiency work.

## Constraints

Keep dispatch and external-effect ordering, live source/epoch admission, credential-free inline payload authority, canonical receipt checks, retry ladders, and continuation payloads unchanged. Reuse the current inventory loader, importer, and follow-up owners. Add no dependency or new state owner.

## Risks and mitigations

Extraction can accidentally change early returns or a mutable skip list. Pass the existing per-job values directly, preserve return wrappers, inspect a whitespace-insensitive diff, and run the existing resource/history/backfill/workout/admission suites. Review concurrent temporal work for merge overlap without modifying its branch.

## Tasks

1. Extract coherent resource execution phases within the current provider factory.
2. Run focused provider regressions, package typecheck, and complexity guard.
3. Inspect the final diff and close this implementation plan in the scoped commit.
4. Open a draft PR and hand off candidate review, CI admission, and ReviewGPT to the parent.

## Decisions

- The measured starting resource function complexity is 143; full-job execution is 106 and remains outside this refactor.
- Helper boundaries follow distinct payload and receipt authority; no generic dispatcher framework or cross-module dependency bag is needed.
- Internal refactor only: product behavior, public contracts, and changelog are unchanged.

## Verification

- `pnpm --filter @murphai/device-syncd test -- test/junction-provider-resources.test.ts test/junction-provider-history.test.ts test/junction-provider-history-recovery.test.ts test/junction-provider-backfill.test.ts test/junction-provider-workout-stream.test.ts test/junction-provider-webhooks.test.ts test/junction-admission-source-reads.test.ts test/junction-blood-pressure-backfill.test.ts test/junction-provider-identity.test.ts test/junction-timeseries-source-reuse.test.ts` passed: 63 files, 1,424 tests. The forwarded separator caused package-wide selection, which also covered strict calendar diagnostics.
- `pnpm --filter @murphai/device-syncd typecheck` passed.
- `pnpm complexity:diff -- --base-ref HEAD -- packages/device-syncd/src/providers/junction.ts` passed: resource dispatcher 143 to 21, timeseries collection/completion 56/39, file debt 405 to 338, maximum 143 to 106. The unchanged full-job executor is now the maximum.
- `git diff --check` passed. Whitespace-insensitive diff inspection confirms preserved phase bodies, source admission, effect order, and return wrappers; the three no-collection receipts now share one constructor.
- No new test, dependency, state owner, or product contract was needed. Existing provider-shaped suites cover the extraction boundaries.
- Parent owns candidate review, Ready admission, required CI, and requested ReviewGPT after draft creation. These remain external completion gates.

## Implementation handoff

Implementation and local proof are complete. Concurrent PR #3311 changes the dense-fidelity return block moved into `executeTimeseriesResourceJob`; a later base reconciliation must preserve its temporal-refresh wrapper. Full-job temporal scheduling stays untouched here. This plan closes implementation only; it does not claim final review or CI completion.
Completed: 2026-09-11
