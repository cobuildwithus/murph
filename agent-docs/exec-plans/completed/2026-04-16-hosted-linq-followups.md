## Goal

Commit the remaining assistant-engine and hosted Linq runtime fixes, then clear the last unrelated dirty file.

## Why

- The worktree still has a small hosted texting follow-up slice spanning assistant-engine and hosted-runtime.
- Those changes are tied to the recent Murph texting/debugging work and should land separately from unrelated UI edits.

## Scope

- `packages/assistant-engine/src/assistant/{auto-reply-channels,automation/reply,execution-context,local-service,notification-turn}.ts`
- `packages/assistant-engine/test/{assistant-local-service-runtime,assistant-notification-turn-runtime}.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
- `packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`

## Constraints

- Keep the slice narrowly about hosted execution default-target propagation and hosted Linq ingest correctness.
- Do not bundle unrelated UI changes.

## Verification

- Focused assistant-engine/runtime tests for the touched files
- `git diff --check`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
