# Split @murph/runtime-state root and Node-only exports

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Split `@murph/runtime-state` into a worker-safe root surface and an explicit Node-only subpath so Cloudflare/hosted code can import the package without transitively depending on filesystem, process, or SQLite helpers.

## Success criteria

- Root `@murph/runtime-state` exports only the worker-safe helpers and types that hosted/browser-compatible callers need.
- Node-only helpers move behind `@murph/runtime-state/node` without breaking existing runtime behavior.
- Existing Node consumers compile after migrating to the explicit Node subpath.
- Focused runtime-state, Cloudflare, and hosted-runtime verification passes.

## Scope

- In scope:
- `packages/runtime-state` export refactor, including any internal module splits needed to keep the root surface clean.
- Import migration for repo callers that use Node-only runtime-state APIs.
- Regression coverage for the new root-vs-node package boundary.
- Out of scope:
- Broad runtime-state API redesign beyond the root/node split.
- Unrelated pre-existing workspace/typecheck failures outside this boundary change.

## Constraints

- Technical constraints:
- Preserve public package ownership inside `@murph/runtime-state`; do not introduce a second package.
- Avoid sibling internal cross-imports; use only declared package entrypoints from consumers.
- Product/process constraints:
- Preserve unrelated dirty worktree edits.
- Create a scoped commit at the end if repo files change.

## Risks and mitigations

1. Risk: Mixed modules like hosted bundle helpers may still pull Node-only behavior into the root surface.
   Mitigation: Split mixed modules so root exports codec/contract helpers while filesystem/materialization helpers move under `node`.
2. Risk: Node consumer migration may miss type-only imports and leave hidden root dependencies behind.
   Mitigation: Audit all `@murph/runtime-state` imports and verify with focused package typechecks/tests.

## Tasks

1. Split runtime-state modules into worker-safe root exports and Node-only exports.
2. Add `@murph/runtime-state/node` package subpath exports and update package docs.
3. Migrate Node/runtime-local consumers to the explicit Node subpath.
4. Add boundary regression coverage and run focused plus required verification.

## Decisions

- Use one package with a `node` subpath instead of creating a second package.
- Keep the root surface limited to worker-safe helpers plus pure hosted bundle reference types/equality helpers, and move hosted bundle codec/filesystem helpers behind the Node subpath.
- Keep pure/shared consumers on the root package and migrate Node/runtime-local callers plus tests to `@murph/runtime-state/node`.

## Verification

- Commands to run:
- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/runtime-state test`
- `pnpm --dir apps/cloudflare test:workers`
- `pnpm --dir packages/assistant-runtime test`
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- Expected outcomes:
- Focused runtime-state / Cloudflare / assistant-runtime checks pass.
- Repo-wide commands may still expose unrelated existing failures; document them if so.

## Results

- Passed: `pnpm exec tsc -p packages/runtime-state/tsconfig.json --noEmit --pretty false`
- Passed: `pnpm --dir packages/runtime-state build`
- Passed: `pnpm --dir packages/runtime-state test`
- Passed: `pnpm exec tsc -p apps/cloudflare/tsconfig.json --noEmit --pretty false`
- Passed: `pnpm --dir apps/cloudflare test:workers`
- Passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/user-runner.test.ts --no-coverage --maxWorkers 1` (run from `apps/cloudflare`)
- Passed: `pnpm exec tsc -p apps/web/tsconfig.json --noEmit --pretty false`
- Passed: `pnpm --dir packages/query exec vitest run test/query.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/assistant-core-boundary.test.ts test/hosted-email-route.test.ts test/hosted-runtime-context.test.ts test/hosted-runtime-usage.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm test:smoke`
- Failed, unrelated: `pnpm typecheck` at existing `packages/cli/src/usecases/{intervention.ts,workout.ts}` `JsonObject` typing errors.
- Failed, unrelated: `pnpm test:packages` at the same existing `packages/cli/src/usecases/{intervention.ts,workout.ts}` typing errors during `build:test-runtime:prepared`.
- Failed, unrelated/untouched: `pnpm --dir packages/assistant-runtime test` still has `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts` expectation failures (`warnSpy.mock.calls.length` expected `1`, received `0`) in untouched maintenance coverage.
Completed: 2026-04-01
