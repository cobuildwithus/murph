## Title

Replace broad same-seq hosted-wake snapshot CAS with a web-owned finalize proof.

## Goal

Make finalized hosted-wake snapshot publication an explicit web-owned state transition instead of allowing any same-seq snapshot rewrite that still matches the cursor version.

## Scope

- `apps/web/src/lib/hosted-wake/{fetch-proof,store}.ts`
- `apps/web/app/api/internal/hosted-wake/{commit,finalize}/route.ts`
- `apps/web/test/hosted-wake-{store,routes}.test.ts`
- `apps/cloudflare/src/{user-runner,web-control-plane}.ts`
- `apps/cloudflare/src/user-runner/{types,runner-wake-processor,runner-state-store}.ts`
- focused `apps/cloudflare/test/{user-runner-hosted-wake,web-control-plane}.test.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- focused shared parser/contract tests if needed

## Constraints

- Keep seq-advancing cursor commits fenced by the existing web-owned terminal receipt path.
- Remove the broad same-seq snapshot-only commit path instead of layering more exceptions onto it.
- Bind finalize authority to the just-committed wake, cursor version, and previous snapshot ref.
- Preserve overlapping dirty-tree hosted-wake, route, and runner edits outside this exact trust-boundary change.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts apps/web/src/lib/hosted-wake/fetch-proof.ts apps/web/src/lib/hosted-wake/store.ts apps/web/app/api/internal/hosted-wake/commit/route.ts apps/web/app/api/internal/hosted-wake/finalize/route.ts apps/web/test/hosted-wake-store.test.ts apps/web/test/hosted-wake-routes.test.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/types.ts apps/cloudflare/src/user-runner/runner-wake-processor.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/test/web-control-plane.test.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts`

## Notes

- The direct proof should show that same-seq snapshot rewrites are rejected without a finalize proof and that replaying a stale finalize proof cannot move the cursor after another finalize wins.
- Scoped verification completed:
  - `pnpm --filter @murphai/hosted-execution exec vitest run --config vitest.config.ts test/hosted-wake-parsers.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-wake-store.test.ts apps/web/test/hosted-wake-routes.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/web-control-plane.test.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.workers.config.ts apps/cloudflare/test/workers/runtime.test.ts --no-coverage`
  - `pnpm --filter @murphai/hosted-execution typecheck`
- Repo/workspace typecheck remains blocked by unrelated pre-existing failures outside this plan:
  - `apps/web` imports a missing `HOSTED_EMAIL_PUBLIC_SENDER_ROUTE_CALLBACK_USER_ID`
  - `apps/cloudflare` imports a missing `bindHostedActiveLinqHomeChat`
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
