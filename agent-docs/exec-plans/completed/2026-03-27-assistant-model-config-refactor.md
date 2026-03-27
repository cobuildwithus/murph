# 2026-03-27 Assistant Model Config Refactor

## Goal

Land the assistant model/provider catalog refactor so setup, provider dispatch, and the Ink chat model switcher share one provider-aware catalog.

## Scope

- `packages/cli/src/assistant/provider-catalog.ts`
- `packages/cli/src/chat-provider.ts`
- `packages/cli/src/setup-assistant.ts`
- `packages/cli/src/assistant/ui/{ink.ts,view-model.ts}`
- `packages/cli/test/{assistant-provider.test.ts,assistant-runtime.test.ts}`

## Constraints

- Preserve adjacent assistant runtime and Ink work already in flight.
- Keep scope limited to shared catalog/model-selection behavior and direct regression proof.

## Verification

- `pnpm exec vitest run --no-coverage packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts`
- `pnpm --dir packages/cli typecheck`
- `pnpm exec tsx --eval ...` direct scenario proof for OpenAI-compatible discovered models and hidden reasoning badges
- Repo-wide wrappers run and remain red outside this scope:
  - `pnpm typecheck` in `packages/query`
  - `pnpm test` in `packages/assistant-runtime`
  - `pnpm test:coverage` in unrelated CLI coverage-wrapper import/type errors

## Progress Notes

- Main refactor landed in commit `d05bfb9`.
- Follow-up test coverage added for the OpenAI-compatible fallback-model branch and normalized `/models` discovery helper behavior.
- Simplify audit ran without additional in-scope code changes to apply.
- Coverage and final review audit tooling did not return usable follow-up output in this session, so final close-out relies on the focused green assistant slice plus local review.
