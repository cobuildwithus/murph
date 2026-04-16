## Goal

Restore the GitHub release lane to green by fixing the stale Strava/provider coverage expectations that are currently failing `release:check`.

## Scope

- `packages/setup-cli/test/setup-wizard.test.ts`
- `packages/contracts/src/providers/**`
- `packages/contracts/test/**`
- `packages/importers/src/device-providers/**`
- `packages/importers/test/**`
- `packages/device-syncd/src/providers/**`
- `packages/device-syncd/test/**`

## Constraints

- Prefer test-only fixes unless local reproduction proves a production behavior regression.
- Preserve current Strava/provider runtime behavior; this lane is about restoring truthful coverage, not redesigning provider flows.
- Re-run the same full release lane that GitHub executes before pushing.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/setup-cli test:coverage`
- `pnpm release:check`
- GitHub workflow polling for the pushed SHA until the required runs complete
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
