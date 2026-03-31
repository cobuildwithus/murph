# Gateway Empty Snapshot And Hard-Cut Cleanup

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Land the remaining externally prepared gateway fixes on top of the current refactored tree: keep the local gateway projection incremental after an empty bootstrap and finish removing the last CLI gateway compatibility shims and aliases.

## Success criteria

- `@murph/gateway-core` persists enough snapshot metadata that an empty serving snapshot does not force rebuilds on every read.
- Local capture sync reads the durable `captures.cursor` meta directly and falls back to rebuild if the mutation log is unexpectedly incomplete.
- `murph` no longer publishes or source-aliases the removed gateway compatibility subpaths.
- Focused gateway tests and repo-required verification pass, or any unrelated blocker is documented precisely.

## Scope

- In scope:
- `packages/gateway-core/src/{store.ts,store/source-sync.ts,store/snapshot-state.ts}`
- `packages/cli/{package.json,scripts/verify-package-shape.ts,test/gateway-core.test.ts,test/gateway-local-service.test.ts}`
- `tsconfig.base.json`
- `ARCHITECTURE.md`
- `packages/gateway-core/README.md`
- remove `packages/cli/src/{gateway-core.ts,gateway-core-local.ts}`
- coordination/plan artifacts needed for this landing
- Out of scope:
- broader gateway API changes
- hosted runner or daemon behavior unrelated to the local snapshot/bootstrap and shim cleanup

## Constraints

- Preserve unrelated dirty-tree edits already present in the repo.
- Treat the supplied patches as intent and port them onto the extracted gateway-store helpers rather than forcing stale hunks onto the live tree.
- Keep full rebuild behavior as the bootstrap and recovery path.
- This is a high-risk repo change because it touches derived-runtime correctness and published package surface, so it uses the full audit path.

## Risks and mitigations

1. Risk: empty projections could still appear uninitialized and rebuild on every read.
   Mitigation: persist explicit snapshot initialization, emptiness, and generated-at metadata in the gateway store and cover it with a focused regression test.
2. Risk: removing CLI gateway shims could break remaining local tests or package-shape expectations.
   Mitigation: update the package manifest, path aliases, and focused tests together; search for remaining old-path references before verification.

## Tasks

1. Register the active lane and keep this plan current.
2. Port the gateway runtime fixes into the extracted store helpers and add/update focused regression coverage.
3. Remove the remaining CLI gateway compatibility exports, aliases, and tests that still assume they exist.
4. Update the matching durable docs.
5. Run focused verification, then required audit passes and repo checks, then close with a scoped commit.

## Decisions

- Keep the landing narrow: only the empty-snapshot bootstrap fix plus the final gateway compatibility-shim cleanup.
- Carry the patch intent into the current extracted file layout instead of recreating stale monolithic code structure.

## Verification

- Commands to run:
- `pnpm --dir packages/gateway-core exec tsc -p tsconfig.json --noEmit --pretty false`
- `pnpm --dir packages/cli exec vitest run test/gateway-core.test.ts test/gateway-local-service.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli exec tsx ./scripts/verify-package-shape.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Actual outcomes:
- Passed: `pnpm install --lockfile-only`
- Passed: `pnpm --dir packages/gateway-core exec tsc -p tsconfig.json --noEmit --pretty false`
- Passed: `pnpm --dir packages/cli exec tsx ./scripts/verify-package-shape.ts`
- Passed: `pnpm --dir packages/cli exec tsc -p tsconfig.typecheck.json --pretty false`
- Passed: `pnpm --dir packages/cli exec vitest run test/gateway-core.test.ts test/gateway-local-service.test.ts --no-coverage --maxWorkers 1`
- Failed for unrelated existing reasons: `pnpm typecheck` in broader workspace packages, including unresolved `@murph/contracts` / existing type errors under `packages/importers/**` and `packages/core/**`.
- Failed for unrelated existing reasons: `pnpm test` in broader non-gateway lanes, including `apps/web verify` Next build contention plus existing failing CLI suites such as `packages/cli/test/{assistant-provider,inbox-model-route,canonical-write-lock,assistant-robustness}.test.ts`.
- Failed for unrelated existing reasons: `pnpm test:coverage` in broader non-gateway CLI suites, including the same assistant/inbox/read-model failures above.

## Completion notes

- Local gateway snapshot state now persists explicit bootstrap metadata so empty projections keep a stable generated-at timestamp and stay incremental.
- Local capture sync now forces a rebuild when capture-serving rows are unexpectedly missing while the stored cursor still looks current, preserving the stated recovery-path guarantee.
- `murph` no longer publishes the removed `./gateway-core` or `./gateway-core-local` compatibility subpaths, and the matching source aliases and shim files are gone.
Completed: 2026-03-31
