# Assistant session resolution dedupe

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Remove the duplicated assistant-session lookup and caller input-shaping scaffolding while preserving current session resolution behavior exactly.

## Success criteria

- `resolveAssistantSession` still resolves in the current order: explicit `sessionId`, alias lookup, conversation-key lookup, then create.
- Alias and binding patch persistence semantics remain unchanged for existing sessions.
- `sendAssistantMessage` and `runAssistantChatWithInk` reuse one helper for operator-default normalization and locator field shaping without changing fallback behavior.
- Targeted assistant tests pass, followed by the repo-required checks.

## Scope

- In scope:
  - `packages/cli/src/assistant/store.ts`
  - `packages/cli/src/assistant/service.ts`
  - `packages/cli/src/assistant/ui/ink.ts`
  - targeted assistant tests
- Out of scope:
  - behavior changes to assistant provider execution, delivery, or transcript persistence
  - command-surface or docs changes outside the execution/coordination artifacts required for this task

## Constraints

- Technical constraints:
  - Keep the existing lookup precedence and new-session defaults unchanged.
  - Keep alias index and conversation-key index persistence unchanged.
- Product/process constraints:
  - Stay within the active assistant-session refactor slice and preserve adjacent in-flight assistant edits.
  - Run the completion workflow audit passes plus required repo checks before handoff.

## Risks and mitigations

1. Risk: A helper extraction subtly changes which defaults win between explicit input, operator config, and persisted session provider options.
   Mitigation: Keep the new caller helper limited to the `resolveAssistantSession` input only and add focused assertions for precedence/defaults.
2. Risk: Session lookup refactoring could change when alias/binding metadata is persisted back to disk.
   Mitigation: Reuse the existing persistence helper exactly and add a focused state test for session-id/alias/conversation-key resolution behavior.

## Tasks

1. Register the task in the ledger and capture the plan.
2. Extract the shared load-and-persist helper inside `assistant/store.ts` and rewire the three existing lookup branches to it.
3. Extract the shared resolve-input normalizer used by `sendAssistantMessage` and `runAssistantChatWithInk`.
4. Update targeted tests for lookup precedence/default stability where needed.
5. Run targeted assistant tests, completion-workflow audits, and repo-required checks.

## Decisions

- Keep any new helpers local to the assistant implementation surface unless a broader export is clearly needed.

## Verification

- Commands to run:
  - `pnpm vitest packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts`
  - completion workflow audit passes
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - Assistant session resolution tests prove unchanged precedence/default behavior.
  - Required repo checks are green, or any unrelated blocker is documented with causal separation.
Completed: 2026-03-18
