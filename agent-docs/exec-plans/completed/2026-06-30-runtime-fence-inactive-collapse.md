# Runtime Fence Inactive Collapse

## Goal

Collapse confirmed-inactive runtime fence handling so UserRunner owns stale-fence policy directly: inactive means clear/replace by the durable attempt/generation/user identity, while committed-progress recovery stays in the accepted transport-failure path.

## Constraints

- Do not add another recovery owner or retry branch.
- Preserve fail-closed behavior for mismatched or indeterminate liveness.
- Preserve exact identity checks before aborting or clearing a fence.
- Treat an explicit null container-name resolution as rejection, not as permission to fall back to raw persisted state.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runtime-invocation-transport-failure.test.ts apps/cloudflare/test/runner-container.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
- `git diff --check`
- `pnpm test:diff apps/cloudflare/src/user-runner/runtime-processing-controller.ts apps/cloudflare/src/user-runner/diagnostics.ts apps/cloudflare/src/user-runner/runtime-processing-responses.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/references/hosted-runtime-protocol.md`

## State

Implementation verified locally; ready for scoped commit and push.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
