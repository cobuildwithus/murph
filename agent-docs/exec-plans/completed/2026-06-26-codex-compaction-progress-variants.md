# Codex Compaction Progress Variants

## Goal

Expand the user-visible Codex context-compaction progress message bank so automatic compaction updates are less repetitive while staying human, understandable, and safe for phone-number based channels.

## Scope

- `packages/assistant-engine/src/assistant-codex-events.ts`
- focused assistant-engine tests for context-compaction progress copy

## Constraints

- Keep messages generic and conversational.
- Do not mention internal provider mechanics, prompts, tokens, model limits, or exact infrastructure.
- Do not add links, marketing language, signup language, or fake personalization.
- Preserve one progress update per compaction event and existing progress delivery idempotency behavior.
- Follow `agent-docs/operations/imessage-deliverability.md` and the supplied iMessage best-practices PDF.

## Verification

- Passed: direct source check confirmed exactly 100 unique ASCII variants, with no banned internal terms or link-like text.
- Passed: `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts -t "sends one current-channel progress update when Codex compacts context"` from `packages/assistant-engine`.
- Passed: `git diff --check`.
- Passed: `pnpm typecheck`.
- Passed: `pnpm test:diff -- packages/assistant-engine/src/assistant-codex-events.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts`.

## Status

- Complete.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
