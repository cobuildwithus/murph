# PR 344 Retention Indeterminate Fence

## Goal

Fix same-mode retention fence handling so indeterminate liveness is retry-only, not reported as an accepted active runner.

## Constraints

- Keep the state model explicit: inactive -> replacement, matching -> accepted, indeterminate -> retry.
- Do not add persisted state, scheduler, route, manager, or broader recovery abstraction.
- Preserve the existing inactive replacement path and active matching acceptance path.

## Plan

1. Change the retention branch to accept only `matching`.
2. Add a focused regression for read-active-liveness failure returning retry with the old fence preserved.
3. Run focused Cloudflare runner tests and typecheck.
4. Commit and push the PR head.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-invocation-transport-failure.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
