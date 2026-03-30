# 2026-03-30 assistant core boundary

## Goal

- Apply the supplied headless-assistant hard cut so `@murph/assistant-services` is removed from the repo and all live runtime consumers use `murph/assistant-core` directly.

## Scope

- root package/release/type wiring that still references `@murph/assistant-services`
- `packages/assistant-runtime/**`
- `packages/assistantd/**`
- CLI export surface only where required to support the direct `murph/assistant-core` runtime boundary
- direct regression tests and boundary proofs
- removal of `packages/assistant-services/**`

## Findings

- The current live tree still contains active and dirty work around `@murph/assistant-services`, including package wiring and assistant-runtime boundary tests.
- The supplied zip intentionally reverses that direction: it removes the wrapper package entirely and makes `murph/assistant-core` the only headless assistant boundary.
- This conflicts with nearby active assistant lanes, so the cut has to be applied carefully on top of the current file state without reverting unrelated assistant/security edits.

## Plan

1. Diff the supplied zip against the current repo and isolate only the assistant-core boundary removal slice.
2. Apply the package/removal/import rewiring on top of the current tree, preserving unrelated local edits.
3. Update boundary tests and direct mocks so runtime and daemon callers prove they depend on `murph/assistant-core`, not `@murph/assistant-services`.
4. Run focused verification and repo-required checks, recording unrelated blockers separately if they still fail outside this lane.
5. Run the mandatory simplify and final-review audits, then commit the exact touched files.

## Verification

- Focused:
  - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts packages/assistant-runtime/test/assistant-core-boundary.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts --no-coverage --maxWorkers 1`
    - passed
  - `pnpm --dir packages/assistantd test`
    - passed
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1`
    - failed in two hosted email authorization cases under `packages/assistant-runtime/src/hosted-runtime/events/email.ts`; this lane only changed the assistant-core import/mocking seam, not the hosted email sender authorization logic
- Repo baseline:
  - `pnpm typecheck`
    - failed upstream in `packages/contracts` script imports for `@murph/contracts` / `@murph/contracts/schemas`
  - `pnpm test`
    - failed upstream in `apps/web` typecheck at `src/lib/hosted-execution/hydration.ts:267`
  - `pnpm test:coverage`
    - failed upstream in `apps/web` typecheck at `src/lib/hosted-execution/hydration.ts:267`
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
