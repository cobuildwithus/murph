## Title

Clean up the remaining repo-wide typecheck blockers after the hosted-assistant local-bridge fix.

## Goal

Remove the invalid `assistant-engine` public subpath exports that violate the repo boundary policy and update the stale `assistantd` HTTP test session fixtures so repo-wide typecheck no longer fails on those known blockers.

## Scope

- `packages/assistant-engine/package.json`
- `packages/assistant-engine/src/assistant-runtime.ts`
- `packages/assistantd/test/http-coverage.test.ts`
- `packages/assistantd/test/http.test.ts` only if the same stale fixture shape must be kept in sync
- `packages/cli/test/{assistant-cli-access,assistant-web-search,inbox-model-harness,assistant-provider,assistant-cli,assistant-core-facades}.test.ts`
- `scripts/verify-workspace-boundaries.mjs`

## Constraints

- Keep the cleanup narrow and greenfield: remove invalid package surface instead of adding compatibility shims.
- Do not touch unrelated dirty-tree runtime or app work.
- Preserve existing test intent; only update stale fixture shape, not behavior.

## Verification

- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistantd typecheck`
- `pnpm --dir packages/assistantd exec vitest run --config vitest.config.ts test/http-coverage.test.ts test/http.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-wrapper-exports.test.ts --no-coverage`
- `pnpm --dir packages/cli exec vitest run --config vitest.config.ts test/assistant-cli-access.test.ts test/assistant-web-search.test.ts test/inbox-model-harness.test.ts test/assistant-provider.test.ts test/assistant-cli.test.ts test/assistant-core-facades.test.ts --no-coverage`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <touched paths>` (still red for unrelated pre-existing `packages/assistant-engine` expectation drift in `assistant-vault-overview.test.ts`, `assistant-cli-tools-capabilities.test.ts`, and `execution-adapters.test.ts`)

## Notes

- The two known blockers are unrelated to the hosted-assistant/Linq fix and were already present in the dirty tree.
- No repo consumers currently import `@murphai/assistant-engine/assistant-cli-access` or `@murphai/assistant-engine/assistant-cli-tools`, so removing those manifest exports is the cleanest end state.
- The cleanup expanded slightly because several `packages/cli` tests and the facade/boundary assertions still referenced the removed subpaths. They now use the root `@murphai/assistant-engine` runtime surface instead.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
