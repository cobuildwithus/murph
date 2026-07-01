# Runtime Fence Legacy Liveness

## Goal

Fix the remaining PR 344 legacy active-fence gap: every existing active-fence liveness probe should resolve a null persisted runner container name to the legacy unversioned per-user container before deciding whether the fence is inactive, exact-active, mismatched, or indeterminate.

## Constraints

- Fresh starts must still use the current versioned runner container resolver.
- A resolver-returned null must stay null and fail closed; do not fall back to the raw stored name after resolver rejection.
- Inactive legacy fences should enter the same inactive recovery/replacement path added by the runtime-fence collapse.
- Exact-active or indeterminate legacy fences must preserve/retry rather than clear.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runtime-invocation-transport-failure.test.ts apps/cloudflare/test/runner-container.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
- `git diff --check`
- `pnpm test:diff apps/cloudflare/src/user-runner/runtime-processing-controller.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/references/hosted-runtime-protocol.md`
- PR-lane ReviewGPT after push.

## State

Implementation verified locally; ready for scoped commit, push, and PR-lane ReviewGPT.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
