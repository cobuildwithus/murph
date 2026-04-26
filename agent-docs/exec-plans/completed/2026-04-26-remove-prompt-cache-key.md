# Remove Prompt Cache Key Follow-Up

## Goal

Keep provider prompt caching simple and observable after removing explicit
`prompt_cache_key` plumbing.

Success criteria:

- Normal assistant provider turns carry existing prompt-cache metadata from
  prompt construction into the turn plan and request diagnostics.
- OpenAI-compatible usage parsing reads nested cached-token counters.
- Focused tests guard stable prompt-cache prefixes and cached-token accounting.
- No new prompt-cache routing/key policy is introduced in this slice.

## Constraints

- Preserve the static/stable/dynamic prompt layering already in
  `system-prompt.ts`.
- Do not add new provider architecture or prompt-cache retention policy in this
  task.
- Keep diagnostics privacy-bounded: hashes and counts only, no prompt bodies,
  user text, raw tool schemas, or identifiers.
- Preserve unrelated dirty work in the shared checkout.

## State

Now: implementing the follow-up fixes requested on 2026-04-26.

## Working Set

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant/provider-turn/planning.ts`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/test/model-behavior.test.ts`
- `packages/assistant-engine/test/provider-execution.test.ts`
- `packages/assistant-engine/test/provider-turn-runner.test.ts`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
