# Remove onboarding summary

## Goal

Remove the first-turn onboarding-summary parser and prompt injection so assistant turns rely on the existing assistant-memory path for durable preferences and instructions instead of `assistant-state/onboarding.json`.

## Why

- The onboarding parser duplicates the existing memory system.
- Its heuristic extraction is brittle and can misclassify mixed user replies.
- The repo already has first-class assistant-memory tools backed by Markdown storage.

## Scope

- Remove onboarding-summary resolution from assistant turn planning and prompt construction.
- Stop chat and auto-reply flows from enabling the onboarding-summary path.
- Update focused tests to assert the memory-first guidance instead of onboarding prompts.

## Non-goals

- Do not redesign assistant memory semantics.
- Do not remove the general assistant-memory tool surface.
- Do not change canonical vault storage.

## Verification

- Focused assistant-core/CLI tests covering prompt construction and chat/auto-reply wiring.
- Repo-required typecheck and test/coverage commands after the change.

## Outcome

- Removed the onboarding-summary planner/prompt path and deleted the onboarding parser module.
- Chat and auto-reply flows now rely on the existing assistant-memory guidance and storage path instead of `assistant-state/onboarding.json`.
- Focused tests were updated to assert memory-backed behavior and the absence of onboarding prompt injection.

## Verification notes

- `pnpm exec vitest run packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts`
  - All 201 focused tests passed.
  - The command still exited non-zero because repo-wide coverage thresholds apply even to narrow Vitest runs.
- `pnpm typecheck`
  - Passed.
- `pnpm test`
  - Failed in unrelated repo lanes: `apps/web` dev smoke lock (`apps/web` smoke dist dir already had an active Next dev process on port `60898`) and a pre-existing `packages/inboxd/test/idempotency-rebuild.test.ts` failure (`no such column: mutation_cursor`).
- `pnpm test:coverage`
  - Failed on the same unrelated `apps/web` smoke lock and the same pre-existing `packages/inboxd/test/idempotency-rebuild.test.ts` failure.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
