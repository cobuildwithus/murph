# Junction ReviewGPT Fixes

## Goal

Resolve actionable findings from the same-thread ReviewGPT pass on the Junction empty historical backfill retry changes.

Success means the 90-day historical retry only completes on useful summary records for the historical summary window, empty backfills avoid writing redundant empty summary snapshots, metadata patch semantics are explicitly tested, and all changes remain scoped to the provider-local retry design.

## Constraints

- Preserve unrelated working-tree changes, especially current Murph Age files.
- Keep the retry policy provider-local; do not add a generic service-layer empty retry, hosted dirty recovery policy, or new persisted backfill table.
- Do not add Junction backfill payload fields outside the manifest.
- Do not log or persist raw provider payloads, health data, local paths, secrets, account identifiers, or auth headers beyond existing import boundaries.
- Keep metadata semantics explicit: `null` is the supported clearing value; `undefined` is ignored.

## Plan

1. Register the ReviewGPT follow-up scope in the coordination ledger.
2. Replace broad backfill completion with a summary-only canonical-bearing predicate that excludes profile and timeseries.
3. Skip empty summary snapshot import for empty historical backfill retry/exhaustion while preserving reconcile behavior.
4. Add focused Junction and metadata regression tests.
5. Run focused package checks, owner-expanded diff verification, and completion audits.

## Verification

- Same-thread ReviewGPT returned prose findings; no patch artifact. Addressed broad completion, empty summary raw artifact churn, and metadata semantics coverage.
- Local reviewer follow-ups found and then cleared source-linkage, floating session timestamp, and floating-provider metric-only completion gaps.
- Passed `pnpm --dir packages/device-syncd test -- junction-provider.test.ts`.
- Passed `pnpm --dir packages/device-syncd test -- service.test.ts -t metadata`.
- Passed `pnpm --dir packages/device-syncd typecheck`.
- Passed `pnpm --dir packages/device-syncd test:coverage`.
- Passed `pnpm typecheck`.
- Passed `git diff --check`.
- Passed `pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/src/metadata.ts packages/device-syncd/test/junction-provider.test.ts packages/device-syncd/test/service.test.ts`.
Status: completed
Updated: 2026-05-25
Completed: 2026-05-25
