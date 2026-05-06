# Idle checkpoint liveness race

## Goal

Tighten hosted idle-shutdown checkpoint handling when runtime liveness reports pending input while a workspace checkpoint is already in flight.

## Success criteria

- If input is observed before the checkpoint commits, the idle checkpoint path returns scheduled work instead of a failed invocation.
- If the checkpoint response has already committed, the idle checkpoint result is treated as committed while pending input remains scheduled by runner liveness.
- The change stays narrow and does not introduce broad abort-signal plumbing.
- Focused assistant-runtime tests cover the in-flight checkpoint race.

## Scope

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`

## Constraints

- Preserve existing hosted mailbox, assistant, and checkpoint behavior outside idle-shutdown checkpoints.
- Do not touch active unrelated Cloudflare runner work.
- Preserve unrelated dirty worktree edits.

## Plan

1. Register this active plan in the coordination ledger.
2. Update idle-shutdown checkpoint handling so an already-returned committed checkpoint wins over liveness abort, while pre-commit input still returns scheduled.
3. Add a focused regression for liveness becoming pending while `workspacePort.checkpoint()` is in flight.
4. Run focused tests, typecheck where feasible, and diff/privacy checks.
5. Close the plan with the appropriate scoped commit, unless overlapping dirty work blocks it.

## Verification

- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-runtime typecheck`
- PASS: `git diff --check -- packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts agent-docs/exec-plans/active/2026-05-06-idle-checkpoint-liveness-race.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts -t "idle-shutdown checkpoint" --no-coverage`
- PASS: post-fix `pnpm --dir packages/assistant-runtime typecheck`
- PASS: post-fix `git diff --check -- packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts agent-docs/exec-plans/active/2026-05-06-idle-checkpoint-liveness-race.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: security/final re-review found no findings after the sentinel liveness error fix.
- BLOCKED/UNRELATED: `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts` passed dependency, boundary, log guard, assistant-runtime typecheck, and assistant-runtime tests, then failed in `apps/cloudflare verify` on active checkpoint-reason split errors in `apps/cloudflare/src/runtime-bridge-workspace.ts`, `apps/cloudflare/test/runtime-bridge-workspace.test.ts`, and `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`.
- BLOCKED/UNRELATED: `pnpm --dir packages/assistant-runtime test:coverage` failed on existing checkpoint-reason expectation drift in `test/hosted-runtime-workspace-assistant-phase.test.ts` and `test/hosted-runtime-workspace-entrypoint.test.ts`.
- BLOCKED/UNRELATED: focused coverage for `test/hosted-runtime-workspace-entrypoint.test.ts` failed on the same checkpoint-reason expectation drift plus single-file coverage thresholds.
- BLOCKED/UNRELATED: post-fix full `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage` failed only in `clears consumed alarm wake when the assistant phase ends idle`, where active checkpoint-reason split work changed `snapshot:maintenance:0` to `snapshot:canonical_runtime_commit:0`.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
