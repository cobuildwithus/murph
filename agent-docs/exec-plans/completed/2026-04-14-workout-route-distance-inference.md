# System Prompt Readability And Workout Route Inference

## Goal

- Refactor the assistant system prompt builder so the file is easier for a human to read and reason about, with clearer section composition and less dense inline prompt assembly.
- Make the assistant system prompt treat freeform workout messages as implicit permission to recover route-derived distance and related metrics when the workout description contains enough route context.
- Clarify that workout capture should try to gather as much recoverable structured detail as practical before writing, instead of waiting for the user to ask for distance explicitly.

## Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/system-prompt.test.ts`

## Constraints

- Keep the change narrow to prompt builder readability, prompt guidance, and prompt tests.
- Preserve the existing route-estimation privacy posture and canonical CLI/tool surfaces.
- Preserve prompt behavior unless the wording change is intentional.
- Avoid broad rewrites outside `packages/assistant-engine`.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/system-prompt.test.ts`

## Notes

- Prompt should make examples like "I ran from my house to the beach, along the coast to another landmark, then back" read as a route-bearing workout log where distance and similar recoverable fields should be inferred via `route estimate` when possible.
- Readability work should favor small section helpers and reusable bullet composition over one large inline assembly block.
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
