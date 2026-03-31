# Hard cut device-sync client contracts into device-syncd

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Move the device-sync-specific client helpers and shared device-sync contracts out of `@murph/runtime-state` into `@murph/device-syncd`, publish them at `@murph/device-syncd/client`, and update existing CLI/local-web consumers to import the canonical owner directly.

## Success criteria

- `packages/device-syncd` owns the shared device-sync client helper/types surface.
- `packages/assistant-core` and `packages/local-web` import that surface from `@murph/device-syncd/client`.
- `packages/runtime-state` no longer exports `device-sync.ts`.
- Durable docs describe `runtime-state` as generic runtime-state ownership and `device-syncd` as the owner of the device-sync client/control-plane contracts.
- Focused verification passes for the touched packages, or any failures are documented as credibly unrelated.

## Scope

- In scope:
- `packages/device-syncd` public API and package exports
- `packages/runtime-state` device-sync export removal
- `packages/assistant-core` and `packages/local-web` consumer import updates
- source-resolution/dependency changes required for `packages/local-web`
- durable architecture/package docs for this ownership boundary
- Out of scope:
- provider behavior changes
- hosted device-sync metadata storage work already in flight
- broader runtime-state cleanup unrelated to device-sync ownership

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits and avoid clobbering the concurrent device-sync metadata-storage lane in `packages/device-syncd/src/{index.ts,shared.ts,store.ts}`.
- Keep imports on declared package entrypoints only; no sibling `src/` reach-ins.
- Maintain one-way dependencies and avoid reintroducing compatibility shims.
- Product/process constraints:
- User asked for a hard cut, not a legacy compatibility alias.
- Skip the optional `simplify` audit for this lane.

## Risks and mitigations

1. Risk: The overlapping metadata-storage lane is already touching `packages/device-syncd/src/index.ts`.
   Mitigation: Read the live file state first, keep the edit minimal, and avoid touching `shared.ts` or `store.ts`.
2. Risk: `packages/local-web` source resolution and package dependencies may fail after the import move.
   Mitigation: Update `package.json` plus the shared workspace-source-resolution allowlist in the same change and typecheck the package directly.
3. Risk: Hidden consumers may still import device-sync helpers from `@murph/runtime-state`.
   Mitigation: Use repo-wide searches before deleting the runtime-state export and rerun focused typechecks after the switch.

## Tasks

1. Add the device-sync ownership lane to the coordination ledger and keep the plan current.
2. Create a canonical `packages/device-syncd/src/client.ts` surface containing the moved client/helper/types code.
3. Update `packages/device-syncd` exports and local types so the package owns the device-sync client/contracts API.
4. Switch `packages/assistant-core` and `packages/local-web` to `@murph/device-syncd/client`, including any dependency/source-resolution changes.
5. Remove the `device-sync.ts` export from `packages/runtime-state` and delete the old file if fully unused.
6. Update architecture/package docs.
7. Run focused verification, then create a scoped commit.

## Decisions

- `@murph/device-syncd` is the canonical owner of device-sync client/control-plane contracts.
- The shared client surface should live at the explicit `@murph/device-syncd/client` subpath instead of the package root.
- `packages/local-web` can drop its direct `@murph/runtime-state` dependency, but its source-resolution allowlist must still include `@murph/runtime-state` because `@murph/device-syncd/client` imports it transitively during source-based Next/Vitest runs.

## Verification

- Commands to run:
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/assistant-core typecheck`
- `pnpm --dir packages/local-web typecheck`
- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/device-syncd exec vitest run test/client.test.ts --config vitest.config.ts --no-coverage`
- `pnpm exec vitest run --config packages/local-web/vitest.config.ts --project local-web packages/local-web/test/device-sync-lib.test.ts packages/local-web/test/workspace-source-resolution.test.ts packages/local-web/test/next-config.test.ts --no-coverage`
- `pnpm --dir packages/runtime-state exec vitest run test/ulid.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/device-syncd build`
- `pnpm --dir packages/local-web build:app`
- `pnpm typecheck`
- `pnpm --dir packages/device-syncd test`
- `pnpm --dir packages/local-web test`
- `pnpm --dir packages/runtime-state test`
- Expected outcomes:
- The touched packages compile with the new ownership boundary.
- Any remaining failures are either fixed or called out as pre-existing/unrelated.

## Results

- `@murph/device-syncd/client` now owns the shared device-sync control-plane client/helper surface and related account/provider contracts.
- `packages/assistant-core` and `packages/local-web` now import the canonical client surface from `@murph/device-syncd/client`.
- `packages/runtime-state` no longer exports `device-sync.ts`; the old device-sync helper tests moved to `packages/device-syncd/test/client.test.ts`.
- `packages/local-web` no longer depends directly on `@murph/runtime-state`, but its source-resolution allowlist still includes it for the transitive `device-syncd` source import graph.
- Verification passed for all commands above, including repo-wide `pnpm typecheck`, the full `device-syncd`, `local-web`, and `runtime-state` test suites, and a `local-web` production build plus `device-syncd` package build.
Completed: 2026-04-01
