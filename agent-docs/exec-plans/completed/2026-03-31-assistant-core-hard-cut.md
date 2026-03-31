# Assistant-Core Hard Cut Boundary Landing

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Move the headless assistant boundary assembly into `packages/assistant-core`, remove the legacy CLI `./assistant-core` export, and cut live code/tests/docs over to `@murph/assistant-core`.

## Success criteria

- `packages/assistant-core/src/index.ts` owns the local-only assistant/inbox/vault/operator-config boundary assembly.
- The legacy CLI compatibility export is removed from live package exports and callers.
- Boundary docs/tests/path aliases describe and verify `@murph/assistant-core` as the owning package.
- Required verification and audit passes are recorded, with any unrelated repo-red lanes clearly separated.

## Scope

- In scope:
  `ARCHITECTURE.md`
  `README.md`
  `agent-docs/index.md`
  `agent-docs/operations/verification-and-runtime.md`
  `agent-docs/references/testing-ci-map.md`
  `packages/assistant-core/{README.md,src/index.ts}`
  `packages/assistant-runtime/{README.md,test/assistant-core-boundary.test.ts}`
  `packages/assistantd/test/assistant-core-boundary.test.ts`
  `packages/cli/{package.json,scripts/verify-package-shape.ts,src/assistant-core.ts}`
  `tsconfig.base.json`
  `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
  Broad transitive assistant helper moves beyond the minimal leaf exports needed for `@murph/assistant-core`.

## Constraints

- Technical constraints:
  Avoid introducing a workspace cycle between `murph` and `@murph/assistant-core`, preserve adjacent dirty worktree edits, and keep non-CLI consumers working through `@murph/assistant-core`.
- Product/process constraints:
  Follow the full audit path because this is a cross-package boundary and documentation cutover.

## Risks and mitigations

1. Risk: moving ownership can accidentally pull CLI-only helpers into the dedicated package or break path/export contracts.
   Mitigation: keep the assistant-core surface minimal and verify package-shape and boundary tests after the cutover.
2. Risk: docs and current-state verification notes drift from the live package ownership.
   Mitigation: update architecture, verification, and testing-reference docs in the same change.

## Tasks

1. Inspect the live assistant-core boundary files and map the uploaded patch against current drift.
2. Land the assistant-core ownership cutover, including minimal Murph leaf exports and removal of the CLI compatibility export.
3. Update current-state docs, tests, and path aliases to the new ownership shape.
4. Run required verification, perform required audits, and close the plan before handoff.

## Decisions

- Treat the uploaded patch as boundary intent and port it onto the current tree instead of forcing a blind apply.

## Verification

- Commands to run:
  `pnpm typecheck`
  `pnpm test`
  `pnpm test:coverage`
- Expected outcomes:
  Required commands pass, or any pre-existing unrelated failures are isolated with focused assistant-core proof recorded.
- Actual outcomes:
  `pnpm typecheck` failed in unrelated `packages/cli/test/local-parallel-test.ts` type-export errors.
  `pnpm test` passed.
  `pnpm test:coverage` failed in existing coverage temp-file infrastructure with `ENOENT` writing `coverage/.tmp/coverage-2.json`.
  Focused assistant-core proof passed via `pnpm exec vitest run packages/assistant-runtime/test/assistant-core-boundary.test.ts packages/assistantd/test/assistant-core-boundary.test.ts --no-coverage --maxWorkers 1`, `pnpm --dir packages/assistant-core exec tsc -p tsconfig.json --noEmit --pretty false`, and `pnpm --dir packages/cli exec tsx ./scripts/verify-package-shape.ts`.
  Required external audit launch was attempted through `pnpm review:gpt --preset simplify --wait ...` but the managed browser draft staging failed because the local ChatGPT browser session was not available; the user then explicitly waived further `review:gpt` runs for this task.

Completed: 2026-03-31
