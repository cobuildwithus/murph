# Core Mutation Boundary Cleanup

## Goal

Make the stale experiment mutation split explicit by renaming divergent helper semantics in `packages/core` and adding regression tests that lock current `createExperiment` versus canonical `updateExperiment`/`stopExperiment` behavior.

## Constraints

- Preserve current user-visible behavior for active experiment create, update, and stop flows.
- Do not silently converge helper semantics in this task.
- Keep scope limited to helper naming clarity, call-site readability, and focused regression coverage.

## Planned Files

- `packages/core/src/public-mutations.ts`
- `packages/core/src/mutations.ts`
- `packages/core/src/canonical-mutations.ts`
- `packages/core/src/history/shared.ts`
- `packages/core/test/core.test.ts`
- `packages/core/test/canonical-mutations-boundary.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- completion workflow audit passes: `simplify` -> `task-finish-review` (with coverage/proof-gap review folded into the final audit)
