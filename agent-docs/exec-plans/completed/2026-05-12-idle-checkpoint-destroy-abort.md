# Idle Checkpoint Destroy Abort

## Goal

Ensure explicit RunnerContainer cleanup preempts an idle-shutdown checkpoint already in progress.

Success criteria:

- Idle-shutdown checkpoint runner requests publish an abort controller through the same active-operation fields used by foreground invocations.
- Runner request timeout handling still applies when no caller abort signal is supplied.
- Explicit `destroyInstance()` aborts the in-progress idle checkpoint and then completes cleanup without waiting for the original runner timeout.
- Focused regression coverage and the hosted runtime protocol doc describe the destroy-preemption behavior.

## Constraints

- Keep the checkpoint best-effort; do not introduce durable idle-checkpoint scheduler state or retry loops.
- Preserve the existing lifecycle lock and write-fence lease model.
- Preserve unrelated dirty hosted-runner and provider-egress edits in the worktree.

## Plan

1. Register this narrow task in the coordination ledger.
2. Publish an idle-checkpoint abort controller and active-operation record while the checkpoint runner request is in flight.
3. Combine optional caller abort signals with runner request timeouts in `postRunnerRequest`.
4. Add a regression test for activity-expiry checkpoint work preempted by explicit cleanup.
5. Update hosted runner lifecycle docs and run focused verification.

## Verification

Completed:

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts`
- `git diff --check -- apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts agent-docs/references/hosted-runtime-protocol.md agent-docs/exec-plans/active/2026-05-12-idle-checkpoint-destroy-abort.md`

Blocked by unrelated existing failures:

- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts agent-docs/exec-plans/active/2026-05-12-idle-checkpoint-hard-cut.md`
- `pnpm typecheck`
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
