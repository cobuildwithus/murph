# PR 344 Inactive Fence Replacement

## Goal

Fix PR 344's stale runtime-fence recovery so a fence with a positively inactive child cannot be preserved indefinitely when committed-progress recovery is unavailable.

## Constraints

- Keep Cloudflare as the execution adapter and web status as recovery truth only when it is conclusively available.
- Do not add a route, scheduler, persisted state, or second recovery owner.
- Preserve active or indeterminate liveness as retry-only.
- Keep direct Durable Object/container RPC call discipline intact.

## Plan

1. Re-read the inactive-fence controller path and tests that currently preserve unknown recovery.
2. Make confirmed inactive fences clear/replace even when committed-progress recovery is unknown, with command-budget exhaustion clearing the dead fence and retrying for the next ensure.
3. Update regression tests to prove inactive+unknown cannot preserve the old attempt id.
4. Run focused Cloudflare tests and typecheck.
5. Commit and push the PR head for the PR-lane ReviewGPT/CI gates.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-invocation-transport-failure.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
