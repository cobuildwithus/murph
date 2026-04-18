# Assistant-runtime wake-lane hard-cut cleanup

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Remove the remaining execution-stage conversation wake follow-up inside
  `packages/assistant-runtime` so hosted message wakes stay on the conversation
  lane instead of re-entering dispatch-era maintenance plumbing.

## Success criteria

- Conversation wakes no longer use the hosted inbox rebuild helper before
  persisting captures.
- Execution-stage conversation follow-up in
  `packages/assistant-runtime/src/hosted-runtime/execution.ts` no longer runs
  parser or assistant automation work.
- Focused assistant-runtime tests cover the new conversation-lane shape.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/**`
  - focused `packages/assistant-runtime/test/**`
- Out of scope:
  - `apps/web/**`
  - `apps/cloudflare/**`
  - shared `packages/hosted-execution/**` contract renames

## Constraints

- Preserve adjacent worktree edits outside the owned assistant-runtime slice.
- Bias toward deleting compatibility helpers when the current tree shows they
  are no longer needed.
- Keep the change production-focused and narrow; avoid speculative refactors.

## Tasks

1. Removed the hosted inbox rebuild wrapper so conversation wakes persist
   captures through `createParsedInboxPipeline` directly.
2. Collapsed execution-stage conversation follow-up so message wakes no longer
   run parser or assistant automation from `execution.ts`.
3. Updated focused hosted-runtime tests for the new wake metrics and parser
   pipeline shape.
4. Verification completed:
   - `pnpm --dir packages/assistant-runtime typecheck`
   - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-events.test.ts test/hosted-runtime-events-coverage.test.ts test/hosted-runtime-execution.test.ts test/hosted-runtime-entry-execution.test.ts test/hosted-runtime-summary.test.ts --no-coverage`
Completed: 2026-04-18
