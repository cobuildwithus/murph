# Assistant Services Boundary

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Make `@murph/assistant-services` the explicit hosted assistant package boundary so `@murph/assistant-runtime` no longer imports `murph/*` directly, while preserving Murph's file-native architecture, canonical-write ownership, and hosted/local trust boundaries.

## Scope

- replace direct `murph/*` imports in `packages/assistant-runtime` with `@murph/assistant-services`
- turn `packages/assistant-services` from a ghost barrel into an explicit hosted-service surface
- move the hosted-safe self-target helper into `@murph/assistant-services`
- update package dependencies and TS project references so hosted runtime points at `assistant-services` instead of `murph`
- update Cloudflare runner tests to mock `@murph/assistant-services`
- update the architecture/runtime docs that describe this boundary when the truth changes

## Constraints

- preserve current hosted execution ordering, resume semantics, and side-effect journaling behavior
- preserve canonical-write ownership in `@murph/core`
- do not pull local CLI UI/env/discovery assumptions into hosted runtime code
- keep current `murph/*` compatibility exports intact for existing callers during this step
- preserve unrelated dirty worktree edits

## Risks

1. A package-only rewrite could accidentally look cleaner than it is while still leaking CLI assumptions into the hosted path.
   Mitigation: make the new boundary explicit in code/docs, move the hosted-safe operator helper for real, and keep the remaining service wrappers clearly scoped as the migration seam.
2. Import-shape changes could break the Cloudflare runner tests or TypeScript build graph.
   Mitigation: update package deps/references and test mocks in the same change and verify the focused runtime/test surface first.
3. Broad service extraction could widen into CLI feature work.
   Mitigation: keep this pass focused on the hosted-facing service surface and avoid changing CLI command behavior.

## Verification Plan

- focused verification around `packages/assistant-runtime`, `packages/assistant-services`, and `apps/cloudflare/test/node-runner.test.ts`
- required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- required completion-workflow audit passes via spawned subagents after functional verification:
  - `simplify`
  - `test-coverage-audit`
  - `task-finish-review`

## Progress

- Done:
  - reviewed the current hosted/runtime boundary, package graph, tests, and docs to confirm `assistant-services` is still a ghost layer
  - moved hosted-runtime imports from `murph/*` to `@murph/assistant-services` surfaces
  - added explicit `@murph/assistant-services` subpath modules and hosted-safe operator-config ownership
  - updated package deps, TS references, docs, and the Cloudflare runner test to target `@murph/assistant-services`
  - converted assistant-services runtime exports from bare passthrough re-exports into local wrapper modules so the package is the callable boundary
  - aligned `@murph/assistant-services/operator-config` with the canonical CLI helper behavior after the final audit caught the compatibility regression
  - added direct boundary coverage in `packages/assistant-runtime/test/assistant-services-boundary.test.ts`
  - re-ran focused verification after the wrapper-module fix:
    - `pnpm --dir packages/assistant-services typecheck`
    - `pnpm --dir packages/assistant-runtime typecheck`
    - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/assistant-services-boundary.test.ts --no-coverage --maxWorkers 1`
    - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1`
  - completed required completion-workflow audit passes:
    - `simplify`
    - `test-coverage-audit`
    - `task-finish-review`
- Now:
  - prepare the exact-path finish-task commit
- Next:
  - hand off focused green verification plus the unrelated repo-wide blockers

## Verification Notes

- Focused verification currently passing:
  - `pnpm --dir packages/assistant-services typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/assistant-services-boundary.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1`
- Focused builds currently blocked by an unrelated existing CLI dependency gap:
  - `pnpm --dir packages/assistant-services build`
  - `pnpm --dir packages/assistant-runtime build`
    - both fail because the transitive CLI build is already red (`packages/cli/src/usecases/health-services.ts` and `packages/cli/src/usecases/integrated-services.ts` import missing `./explicit-health-family-services.js`)
- Repo-wide baseline checks currently failing in unrelated existing lanes:
  - `pnpm typecheck`
    - existing failures in `packages/contracts/scripts/verify.ts`:
      - cannot resolve `@murph/contracts`
      - several implicit-`any` parameters
  - `pnpm test`
  - `pnpm test:coverage`
    - both currently stop in the existing `packages/cli` build lane because:
      - `packages/cli/src/inbox-app/types.ts` cannot resolve `@murph/inboxd`
      - `packages/cli/src/linq-runtime.ts` cannot resolve `@murph/inboxd`
      - `packages/cli/src/telegram-runtime.ts` cannot resolve `@murph/inboxd`
      - `packages/cli/src/linq-runtime.ts` has implicit-`any` parameters
Completed: 2026-03-28
