# Runtime Fence Recovery Collapse

## Goal

Collapse PR 344's runtime-fence recovery logic so inactive active fences have one controller-owned path: prove completion from durable web status when available, otherwise replace the stale fence by identity. Preserve foreground priority, fail closed on ambiguous/mismatched liveness, and avoid new schedulers, queues, or recovery owners.

## Constraints

- `apps/web` remains the source of hosted product/control facts.
- `apps/cloudflare` remains a thin execution coordinator over write fences and containers.
- Container liveness is evidence only; it must not own completion policy.
- Foreground/default work may preempt `inbox_media_retention`; ambiguous active foreground children must be preserved/retried.
- Prefer deleting split branches and helpers over adding a new state machine.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runtime-invocation-transport-failure.test.ts apps/cloudflare/test/runner-container.test.ts` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm test:diff apps/cloudflare/src/user-runner/runtime-processing-controller.ts apps/cloudflare/src/user-runner/diagnostics.ts apps/cloudflare/src/user-runner/runtime-processing-responses.ts apps/cloudflare/test/user-runner-alarm.test.ts agent-docs/references/hosted-runtime-protocol.md` passed.
- `git diff --check` passed.
- PR-lane ReviewGPT after push.

## State

Implementation and local verification complete; PR-lane review pending after push.
Status: completed
Updated: 2026-06-30
Completed: 2026-06-30
