# First chat check-in

## Goal

Restore the lightweight injected first-chat check-in for interactive chat sessions while keeping the removed onboarding persistence path and separate onboarding summary system out of the runtime.

## Why

- The user wants the opening conversational questions back.
- The prior onboarding parser and separate saved state were intentionally removed.
- The assistant should ask the first-turn questions as prompt guidance only and rely on normal assistant memory instead of a separate onboarding persistence path.

## Scope

- Add a chat-only request flag that opts interactive chat sessions into first-turn check-in guidance.
- Inject brief first-turn system-prompt instructions on brand-new chat sessions only.
- Keep auto-reply and non-chat assistant flows free of the injected check-in.
- Expand assistant memory guidance so the model proactively saves useful future continuity while keeping sensitive health memory restricted to private assistant contexts.
- Update focused assistant tests for the new chat-only behavior.

## Non-goals

- Do not restore `onboarding.json` or any onboarding parser.
- Do not auto-persist name, tone, or goals from ordinary user prompts.
- Do not change canonical vault storage or assistant memory storage format.

## Verification

- Focused assistant prompt and chat/runtime tests covering chat first turn plus non-chat exclusions.
- Repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Outcome

- Interactive chat now opts into a prompt-only first-turn check-in that asks about preferred name, tone, and health goals without restoring `onboarding.json` or any separate onboarding parser/state.
- The injected first-turn guidance now also tells the assistant to give a two-sentence-max Murph overview covering logs, patterns, health questions, and the supported user message channels and media types.
- Assistant memory guidance now explicitly prefers proactively saving useful future continuity, while manual and non-private health-memory writes remain blocked unless the turn is marked as a private assistant context.

## Verification notes

- Direct scenario check passed: `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-service.test.ts -t "sendAssistantMessage injects the first-chat check-in only for an opted-in first turn"`
- Focused assistant regression suite passed: `pnpm exec vitest run --coverage.enabled=false packages/cli/test/assistant-cli.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-state.test.ts`
- `pnpm typecheck` passed.
- `pnpm test` still fails in unrelated pre-existing repo lanes:
  - `apps/web` smoke lock: active Next dev process on pid `73174`, port `60898`
  - `packages/inboxd/test/idempotency-rebuild.test.ts`: `openInboxRuntime rejects runtime rows missing canonical attachment ids`
- `pnpm test:coverage` still fails in unrelated pre-existing/environmental repo lanes:
  - `apps/web` smoke lock: active Next dev process on pid `73174`, port `60898`
  - `packages/inboxd/test/idempotency-rebuild.test.ts`: `openInboxRuntime rejects runtime rows missing canonical attachment ids`
  - `packages/cli/test/release-script-coverage-audit.test.ts`: missing `.tmp-review-gpt-data/murph-test-data-20260402-030215Z.zip`

Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
