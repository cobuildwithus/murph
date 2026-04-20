## Title

Hard-cut `RunnerWakeProcessor.invokeRunner` to require `runDrain`.

## Goal

Remove the stale optional/legacy invocation seam so hosted run-drain execution always passes a real `HostedRuntimeDrainRequest` into the runtime job request.

## Scope

- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- scoped verification and commit artifacts required by repo policy for this slice

## Constraints

- Treat this as a narrow Cloudflare hosted-runner fix only.
- Preserve unrelated dirty-tree edits and overlapping hosted-run / hosted-wake lanes.
- Do not broaden into runtime model or parser changes unless the file-level hard cut requires them.

## Verification

- passed: `pnpm typecheck`
- failed for unrelated pre-existing reason: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-wake-processor.ts`
  - `apps/cloudflare/test/container-entrypoint.test.ts` still expects HTTP `400` but receives `501` in `startHostedContainerEntrypoint > returns a stable invalid request error when the run body is not an object`
- passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-wake-processor.test.ts --no-coverage`
- passed: `git diff --check`

## Notes

- The current call sites already build a `HostedRuntimeDrainRequest`; this change removes the remaining nullable signature/conditional request seam so the runtime job cannot silently omit `request.runDrain`.
- No `RunnerPendingCommitRecord` or legacy `resume` references remain in `apps/cloudflare/src/user-runner/runner-wake-processor.ts`.
Status: completed
Updated: 2026-04-20
Completed: 2026-04-20
