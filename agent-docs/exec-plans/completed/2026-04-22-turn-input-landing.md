# Turn Input Landing

## Goal

Land the supplied local-runtime assistant turn-input patch on current HEAD without widening beyond the assistant auto-reply, capture-grouping, local-service, and daemon-shortcut seams.

## Constraints

- Preserve unrelated dirty-tree edits.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Keep the landing scoped to `packages/assistant-engine` and the directly coupled `packages/assistant-cli` daemon/runtime wrappers.
- Do not widen into hosted runtime or unrelated assistant provider/runtime work.

## Planned verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/automation/grouping.ts packages/assistant-engine/src/assistant/automation/reply.ts packages/assistant-engine/src/assistant/automation/run-loop.ts packages/assistant-engine/src/assistant/automation/scanner.ts packages/assistant-engine/src/assistant/automation/startup-recovery.ts packages/assistant-engine/src/assistant/automation.ts packages/assistant-engine/src/assistant/conversation-ref.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/service-contracts.ts packages/assistant-engine/src/assistant/turn-input.ts packages/assistant-engine/src/assistant/turns.ts packages/assistant-cli/src/assistant/automation/run-loop.ts packages/assistant-cli/src/assistant-daemon-client.ts`
- Focused direct proof if the diff-aware lane is blocked by unrelated work

## Audit plan

- Required `coverage-write`
- Required `task-finish-review`

## Outcome

- Landed the local assistant turn-input seam plus the late-capture before-delivery fence, bounded auto-reply revision, shared conversation-capture identity helpers, and daemon shortcut guards.
- Added focused assistant-engine and assistant-cli regression coverage, including:
  - grouping and conversation-capture identity unit tests
  - inbox-backed late-capture filtering tests
  - auto-reply revision/retry and revision-budget exhaustion tests
  - local-service blocked-delivery test for `AssistantTurnRevisionRequiredError`
  - assistant-cli daemon safety tests for `beforeDelivery` and `turnInputPort`
- Addressed final-review findings by:
  - removing the incorrect `sourceId: query.conversation.source` filter from late-capture lookup
  - threading `afterCreatedAt` through the inbox-backed late-capture query and adding the corresponding regression test

## Verification run

- `pnpm --filter @murphai/assistant-engine --filter @murphai/assistant-cli typecheck` ✅
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage src/assistant/conversation-ref.test.ts src/assistant/turn-input.test.ts src/assistant/automation/grouping.test.ts test/conversation-ref.test.ts test/assistant-automation-support.test.ts test/assistant-automation-runtime.test.ts test/assistant-local-service-runtime.test.ts` ✅
- `pnpm --dir packages/assistant-cli exec vitest run --config vitest.config.ts --no-coverage test/assistant-daemon-client-owned-coverage.test.ts test/assistant-command-runtime.test.ts test/assistant-runtime-service-seams.test.ts` ✅
- `pnpm typecheck` ❌ blocked by unrelated pre-existing `packages/device-syncd/test/service.test.ts` errors on `payload` narrowing
- `git diff --check -- <task paths>` ✅

## Audit results

- `coverage-write` completed and added the late-capture revision + blocked-delivery proof coverage.
- `task-finish-review` found two real issues in the late-capture lookup; both were fixed and reverified locally.
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
