# Hosted Fresh Input Priority

## Goal

Ensure hosted workspace invocations that just imported fresh conversation assistant input run the assistant reply lane before optional system mailbox, device-sync, provider-cleanup, cron, or old retry work can consume the foreground invocation, and make foreground delivery select the current assistant pass's outbox intents before stale due backlog.

## Constraints

- Preserve mailbox import/checkpoint semantics and existing system mailbox handling when there is no fresh conversation input.
- Do not run optional hosted cleanup lanes ahead of fresh assistant input.
- Keep foreground delivery selection scoped to current-turn delivery intents; old due outbox work stays on background/global collection.
- Keep sensitive runtime data out of logs, tests, docs, and commit messages.
- Preserve unrelated dirty worktree edits.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/src/hosted-runtime/models.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/run-loop.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/src/assistant/automation/shared.ts`

## Verification Plan

- Focused assistant-runtime regression test for fresh input plus due system mailbox/provider cleanup.
- Focused callback regression for stale backlog plus preferred current-turn delivery under the effect cap.
- Package-level assistant-runtime coverage or `pnpm test:diff` if it truthfully covers this change.
- `pnpm typecheck`.

## State

- Done: implemented fresh-input priority and current-turn delivery intent selection; added regressions for system mailbox/provider cleanup deferral, assistantInputIds-only freshness, terminal cleanup follow-up, fresh-input delivery without foreground provider cleanup drain, and preferred current-turn delivery under the effect cap.
- Verification: focused assistant-runtime callback/phase tests passed; assistant-engine focused automation test passed; assistant-engine and assistant-runtime package typechecks passed; assistant-engine and assistant-runtime package coverage passed; root typecheck is blocked by unrelated Cloudflare test type errors outside this task.
- Commit: pending scoped commit from archived plan state.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
