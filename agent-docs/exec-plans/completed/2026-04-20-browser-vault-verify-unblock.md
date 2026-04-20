# Browser-vault verify unblock

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Restore the Cloudflare owner verify lane and the diff-scoped repo lane by aligning stale tests with the current hosted browser-vault and run-drain request contracts.

## Success criteria

- `apps/cloudflare test/browser-vault-store.test.ts` compiles against the current `BrowserVaultSnapshot` contract.
- `packages/query/src/browser-snapshot.ts` typechecks without the invalid generic constraint errors.
- `packages/assistant-runtime/test/hosted-runtime-runner.test.ts` compiles against the current `HostedAssistantRuntimeJobRequest` contract.
- The narrowed verification lane for the touched owners passes after the fix.

## Scope

- `packages/query/src/browser-snapshot.ts`
- `apps/cloudflare/test/browser-vault-store.test.ts`
- directly coupled `packages/{query,assistant-runtime}/test/**` only if required by the narrow verification lane

## Constraints

- Keep the new dashboard projection snapshot contract; do not revert to the legacy canonical-entity snapshot shape just to satisfy old tests.
- Preserve overlapping dirty-tree edits in the active browser-vault projection work.
- Limit changes to type/test alignment needed to unblock the verify lane.

## Verification

- passed: `pnpm --dir apps/cloudflare typecheck`
- passed: `pnpm --dir apps/cloudflare test:node`
- passed: `pnpm --dir apps/cloudflare test:workers`
- passed: `pnpm --dir packages/query test`
- passed: `pnpm --dir packages/assistant-runtime test`
- passed: `pnpm test:smoke`
- passed: `pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`
- passed: `pnpm --dir apps/cloudflare test:e2e:local` (the vitest e2e lane reported passing before the long-running helper process stayed attached)

## Notes

- The Cloudflare verify blocker was stale browser-vault fixture usage in `apps/cloudflare/test/browser-vault-store.test.ts` plus stale browser-vault snapshot fixtures in coupled tests.
- `packages/assistant-runtime/test/hosted-runtime-runner.test.ts` already had a broader in-flight diff in the dirty tree. Its current green state was preserved for verification, but that overlapping file is intentionally excluded from the scoped commit for this task.
