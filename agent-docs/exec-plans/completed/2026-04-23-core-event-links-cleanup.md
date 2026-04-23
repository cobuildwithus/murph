# Remove legacy event relatedIds adapters from core event/history seams

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Remove deprecated `relatedIds` handling from the `packages/core` event/history write seams so canonical event relations are links-only end to end.

## Success criteria

- `packages/core` event upsert, history append, and device-import event ingestion no longer accept or translate `relatedIds`.
- Shared core relation helpers and history types expose links-only inputs/outputs.
- Focused proof covers links-only writes plus explicit rejection of deprecated `relatedIds`.
- Routed verification and required completion workflow passes run, or any unrelated pre-existing failures are documented.

## Scope

- In scope:
- `packages/core/src/{event-links.ts,domains/events.ts,history/{api.ts,types.ts},mutations.ts}`
- Directly coupled tests under `packages/core/test/**`
- Narrow adjacent typed producer surfaces if they only exist to describe the cleaned core API
- Out of scope:
- Query/search compatibility projections that still derive `relatedIds`
- Assessment/bank/family/genetics relation shapes outside the event/history seam
- Broader cross-package canonical entity cleanup beyond directly coupled typed producers/tests

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits and keep the diff additive on the existing `packages/core` rows.
- Use links-only storage semantics already established by the event spine; do not add another compatibility channel.
- Product/process constraints:
- Follow the standard repo-change workflow: scoped verification, required `coverage-write`, required `task-finish-review`, then a scoped commit.

## Risks and mitigations

1. Risk: Silent dropping of legacy `relatedIds` inputs would hide stale callers.
   Mitigation: Reject deprecated `relatedIds` explicitly at the remaining core ingestion seams.
2. Risk: Cleanup could widen into query/export compatibility surfaces that still intentionally expose `relatedIds`.
   Mitigation: Keep the diff scoped to `packages/core` write seams plus directly coupled typed producers/tests only.

## Tasks

1. Register the scoped cleanup in the active plan and coordination ledger.
2. Remove `relatedIds` support from core event/history/device-import inputs and shared relation helpers.
3. Update focused tests and any directly coupled typed producer surfaces to use canonical links.
4. Run routed verification, required audit passes, and finish with a scoped commit.

## Decisions

- Reject deprecated `relatedIds` inputs instead of silently ignoring them.
- Treat legacy stored history rows that still rely on `relatedIds` as invalid rather than reconstructing canonical links at read time.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir packages/core test:coverage`
- `pnpm test:smoke`
- Focused `vitest` runs for the touched `packages/core` test files as needed during iteration
- Expected outcomes:
- Touched `packages/core` relation paths stay links-only and fail fast on deprecated `relatedIds`.
Completed: 2026-04-23
