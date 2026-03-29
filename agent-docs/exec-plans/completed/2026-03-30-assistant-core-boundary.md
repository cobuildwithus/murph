## Goal

Land the supplied assistant-core boundary seam so non-CLI consumers use one explicit `murph/assistant-core` subpath and `@murph/assistant-services` stays a thin hosted compatibility shim.

## Success Criteria

- `murph` publishes `./assistant-core` with the intended headless assistant/inbox/vault/operator-config surface.
- `packages/assistant-services` re-exports that surface instead of owning duplicate runtime-state or operator-config logic.
- `packages/assistantd` and boundary tests consume `murph/assistant-core` rather than the root `murph` export.
- Focused boundary regressions land without widening into unrelated assistant/provider refactors.

## Scope

- `packages/cli/src/assistant-core.ts`
- `packages/cli/{package.json,scripts/verify-package-shape.ts}`
- `tsconfig.base.json`
- `packages/assistant-services/**`
- `packages/assistantd/src/{http.ts,service.ts}`
- `packages/assistantd/{package.json,test/assistant-core-boundary.test.ts}`
- `packages/assistant-runtime/test/assistant-services-boundary.test.ts`
- `apps/cloudflare/test/node-runner.test.ts`
- Matching docs/tests only if required to keep the boundary and verification truthful.

## Risks / Notes

- Preserve adjacent edits from the active assistant/provider seam lane; this change should stay at the public-boundary layer and not reshape provider behavior.
- `packages/assistantd/test/http.test.ts` is already dirty in the worktree; avoid overwriting it unless verification forces a tightly scoped compatibility follow-up.
- Repo-wide verification may still see unrelated failures from other active lanes, so record any defensible separation clearly if it happens.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
