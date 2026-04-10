# Route module split and composability cleanup

Status: completed
Created: 2026-04-10
Updated: 2026-04-10

## Goal

- Split the oversized CLI-owned Mapbox route module into smaller focused files without changing the external `vault-cli route estimate` behavior or schema surface.

## Success criteria

- `packages/cli/src/mapbox-route.ts` becomes a thin public orchestrator instead of a 1000+ line owner file.
- Shared contracts, point lookup logic, HTTP helpers, and elevation helpers live in focused modules with clear responsibilities.
- Existing command and manifest imports remain stable or become simpler.
- Route behavior and test coverage stay unchanged after the refactor.

## Scope

- In scope:
- CLI-owned Mapbox route implementation files and the focused route tests
- Minimal import rewiring in route command/manifest files if needed
- Out of scope:
- assistant-side CLI policy wrappers
- broader command-manifest restructuring beyond imports needed for the route split
- product behavior changes to route estimation itself

## Constraints

- Keep the public API clean and stable.
- Do not introduce a generic routing abstraction.
- Preserve the privacy posture and existing result schema.
- Keep the refactor proportional; prefer a few focused modules over many tiny files.

## Tasks

1. Extract route contracts and shared types.
2. Extract point-resolution and Mapbox lookup helpers.
3. Extract elevation and sampling helpers.
4. Leave `mapbox-route.ts` as the public orchestration surface and re-export point-in-time public contracts.
5. Run truthful route-focused verification and commit only the route-module-split lane.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run packages/cli/test/mapbox-route.test.ts --config packages/cli/vitest.workspace.ts`
- `pnpm test:diff packages/cli/src/mapbox-route.ts packages/cli/src/mapbox-route-contracts.ts packages/cli/src/mapbox-route-client.ts packages/cli/src/mapbox-route-points.ts packages/cli/src/mapbox-route-directions.ts packages/cli/src/mapbox-route-elevation.ts packages/cli/test/mapbox-route.test.ts`

## Outcome

- The split kept `packages/cli/src/mapbox-route.ts` as the public owner module while moving contracts, HTTP helpers, point resolution, directions, and elevation logic into focused siblings.
- `pnpm typecheck` passed.
- `pnpm exec vitest run packages/cli/test/mapbox-route.test.ts --config packages/cli/vitest.workspace.ts` passed with 9 route tests.
- `pnpm test:diff ...` reached the package-wide CLI test lane and failed on the pre-existing unrelated `packages/cli/src/vault-cli.ts` overlap that also breaks `packages/cli/test/runner-vault-cli.test.ts`. The route split itself typechecked and passed the focused route suite.
Completed: 2026-04-10
