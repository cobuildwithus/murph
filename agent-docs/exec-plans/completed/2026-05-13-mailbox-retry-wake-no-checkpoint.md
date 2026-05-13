# Mailbox retry wake no checkpoint

Status: completed
Created: 2026-05-13
Updated: 2026-05-13

## Goal

- Treat mailbox `nextRetryAt` as a runtime scheduling result, not workspace dirty state, when mailbox import made no local state change.
- Preserve prompt liveness by continuing to return the retry wake through `nextWakeAt`.

## Success criteria

- A pure retryable mailbox blocker with unchanged local import state returns scheduled `nextWakeAt` without forcing an idle-shutdown full checkpoint.
- A mailbox import that changes local state still marks the runtime dirty and checkpoints with the projected retry wake when needed.
- Focused tests prove the pure retryable sidecar path and deferred dirty predicate.

## Scope

- In scope: hosted mailbox dirty-state predicate, focused assistant-runtime tests, and the durable hosted runtime protocol sentence for retry-only wakes.
- Out of scope: Cloudflare Durable Object scheduling, web workspace schema, checkpoint format changes, and unrelated dirty runtime wake deadline work.

## Constraints

- Keep architecture simple: no new durable state, scheduler, queue, or compatibility layer.
- Preserve unrelated worktree edits, especially the nearby active dirty runtime wake checkpoint plan.

## Risks and mitigations

1. Risk: Dropping dirty state could lose liveness for retryable mailbox blockers.
   Mitigation: Keep `nextRetryAt` in invocation projection and result `nextWakeAt`.
2. Risk: State-changing imports with a retry wake could skip necessary persistence.
   Mitigation: Keep `stateChanged` as dirty and keep retry wake attached to checkpoint requests when checkpointing happens.

## Tasks

1. Patch deferred mailbox import dirty predicate.
2. Update tests for pure retryable sidecar scheduling without snapshot/checkpoint.
3. Add/adjust focused predicate coverage.
4. Run focused assistant-runtime verification.
5. Run required audits or report environment/tooling blockers.

## Decisions

- The dirty-state rule is `stateChanged` or other local runtime mutations only; `nextRetryAt` alone is not a workspace mutation.

## Verification

- Passed: `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-mailbox-checkpoint.test.ts test/hosted-runtime-workspace-runner.test.ts test/hosted-runtime-workspace-entrypoint.test.ts` (package test suite ran: 52 files, 550 passed, 2 skipped).
- Passed: `pnpm typecheck`.
- Passed: `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts packages/assistant-runtime/test/hosted-runtime-mailbox-checkpoint.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`.
- Passed: `pnpm docs:drift`.
- Passed: `git diff --check -- <task files>`.
Completed: 2026-05-13
