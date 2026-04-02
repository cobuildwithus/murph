# Centralized Assistant System Prompt

## Goal

Land the supplied prompt-seam refactor that extracts assistant system-prompt construction into an owned module, centralizes user-facing channel presentation checks, and updates prompt/test wording without disturbing unrelated in-flight assistant/runtime work.

## Scope

- Add shared assistant prompt/presentation helpers under `packages/assistant-core/src/assistant/`.
- Update the existing conversation-policy, reply-sanitizer, provider-turn-runner, and CLI guidance wiring to use those helpers.
- Adjust focused assistant-service expectations to match the new prompt wording and extracted seam.

## Constraints

- Preserve unrelated dirty worktree edits and the adjacent exclusive assistant lane.
- Port only the supplied patch intent; do not widen into unrelated assistant architecture or memory-behavior redesign work.
- Keep verification grounded in focused assistant proof plus repo-required checks, calling out unrelated baseline failures explicitly.

## Verification

- `pnpm build:test-runtime:prepared`
- `pnpm exec vitest run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Extracted the assistant system prompt into `packages/assistant-core/src/assistant/system-prompt.ts` and centralized user-facing channel classification in `packages/assistant-core/src/assistant/channel-presentation.ts`.
- Updated conversation privacy, outbound reply sanitization, and CLI guidance wiring to use the new shared seams.
- Restored append-vs-write memory guidance and the dangerous-write warning after the completion audit flagged that regression risk in the extracted prompt.
- Focused assistant tests plus package-local assistant-core and CLI typechecks passed.
- Repo-wide verification still fails in unrelated dirty-tree baselines: `pnpm typecheck` at `packages/inboxd/src/connectors/linq/normalize.ts`, and `pnpm test` / `pnpm test:coverage` at `packages/messaging-ingress/test/linq-webhook.test.ts`.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
