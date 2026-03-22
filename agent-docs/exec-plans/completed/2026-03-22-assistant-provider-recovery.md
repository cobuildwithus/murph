# assistant provider recovery

Status: completed
Created: 2026-03-22
Updated: 2026-03-22

## Goal

- Integrate the assistant provider recovery/progress patch on top of the current assistant runtime and close the reviewed regressions before acceptance.

## Success criteria

- Codex execution emits live provider progress events while preserving the existing streaming trace path.
- Reconnectable provider disconnects preserve the recovered provider session id and only resume automatically for actual connection-loss failures.
- Inbox auto-reply defers reconnectable provider drops without advancing the cursor or duplicating transcript turns for the same inbound capture.
- Ink chat surfaces live provider progress rows without overwriting prior-turn progress rows when provider item ids repeat.
- Focused assistant tests and the required repo checks pass after the merge.

## Scope

- In scope:
  - `assistant-codex` progress parsing and connection-loss classification
  - shared provider-turn recovery helpers and assistant service recovery wiring
  - chat-provider progress plumbing
  - assistant Ink progress row handling and recovered-session reuse
  - auto-reply retry semantics plus focused assistant test updates
- Out of scope:
  - changing channel transport implementations outside the assistant runtime
  - broader assistant transcript model changes beyond the retry-duplication fix
  - unrelated CLI, docs, or setup refactors

## Risks and mitigations

1. Risk: the new progress path could regress the existing streaming trace UI.
   Mitigation: keep `onTraceEvent` intact and layer progress rows in parallel.
2. Risk: provider sessions could be resumed after non-retryable failures.
   Mitigation: gate recovery persistence on explicit connection-loss context only and add a regression test.
3. Risk: retrying the same inbox capture could duplicate transcript entries or lose retry position.
   Mitigation: keep the cursor unchanged on reconnectable failures and suppress failed-turn user transcript persistence for auto-reply flows.

## Tasks

1. Register the work in the coordination ledger and inspect the current assistant runtime files against the provided patch.
2. Implement shared recovery/progress plumbing across Codex execution, chat-provider, assistant service, Ink UI, and auto-reply.
3. Add or update focused assistant tests for reconnect classification, session persistence, retry semantics, and Ink progress rows.
4. Run the required repo checks plus completion-workflow audit passes, then clean generated residue and hand off the result.

## Verification

- Focused: assistant Codex/provider/service/runtime Vitest files covering recovery, progress, and auto-reply behavior.
- Required: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Outcome:
  - `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-codex.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts` passed.
  - `pnpm typecheck` passed.
  - `pnpm test` failed in a pre-existing workspace build step because `packages/cli/src/inbox-services.ts` already contains duplicate `config` identifiers; this task did not modify that file.
  - `pnpm test:coverage` failed in the same pre-existing `packages/cli/src/inbox-services.ts` workspace build step for the same unrelated reason.
Completed: 2026-03-22
