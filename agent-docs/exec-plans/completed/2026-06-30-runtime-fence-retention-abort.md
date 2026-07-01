# Runtime Fence Retention Abort

## Goal

Fix the round 19 retention preemption race: foreground replacement behind an inactive retention fence must first make the exact queued retention attempt unable to run later.

## Constraints

- Reuse the existing identity-checked abort seam.
- Do not add a new scheduler, queue, or recovery owner.
- Keep generic inactive-fence replacement simple; only retention-to-foreground preemption needs abort-before-clear.

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
