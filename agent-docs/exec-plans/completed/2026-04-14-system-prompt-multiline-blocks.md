# System Prompt Multiline Blocks

## Goal

- Refactor `packages/assistant-engine/src/assistant/system-prompt.ts` so the prompt content is written primarily as large multiline text blocks instead of small string-construction helpers.
- Preserve the recent workout route-inference guidance and existing prompt behavior while making the file more comfortable for a human to edit directly.

## Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/system-prompt.test.ts` only if assertions need to move with the wording

## Constraints

- Keep the change narrow to `packages/assistant-engine`.
- Preserve the current route-estimation guidance for route-bearing workout logs.
- Avoid touching unrelated in-progress work under `packages/cli/**` and `packages/operator-config/**`.

## Verification

- `pnpm typecheck`
- `pnpm --dir packages/assistant-engine test -- system-prompt.test.ts`
- note any still-unrelated `pnpm test:diff ...` issues if they reappear

## Notes

- User preference is for big multiline quoted prompt sections over helper-heavy sentence/bullet composition.
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
