# PR 213 ReviewGPT round 11

## Goal

Resolve accepted ReviewGPT round 11 findings on PR 213:

1. `finish_without_reply` acceptance side-effect failures must not leave a
   durable marker for a tool call Codex can recover from with a visible answer.
2. No-reply markers for live-steered delivery contexts must be written after the
   user input for that context is durable.
3. Notification decision turns should use their existing structured `skip`
   contract instead of the general `finish_without_reply` tool.

Success means the fixes are minimal, focused regressions pass, scoped
verification passes, the PR branch is pushed, and the next ReviewGPT round is
started.

## Constraints / Assumptions

- Preserve the round-10 flat outbox contract.
- Keep no-reply durability centralized; do not add a new persisted state owner.
- Keep notification skip behavior through the structured decision schema.
- Do not expose secrets, local account identifiers, home-directory paths, or
  sensitive payloads in committed artifacts.

## Key decisions

- `finish_without_reply` acceptance side-effect failures fail the provider turn
  instead of returning a recoverable dynamic-tool error.
- Local-service drains acknowledged live-steered inputs through the no-reply
  delivery-context ordinal before writing the marker.
- Notification turns disable `finish_without_reply` entirely and rely on the
  structured `skip` response.

## State

Active.

## Done

- Pushed round-10 commit `69fe19cafb83`.
- Ran ReviewGPT round 11 against PR #213 and captured three accepted findings.
- Patched Codex no-reply failure handling, local live-steer marker ordering,
  and notification no-reply deletion.
- Verification passed:
  - `pnpm exec vitest run packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts`
  - `pnpm typecheck`
  - `git diff --check`
  - `pnpm test:smoke`
  - `pnpm test:diff -- packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/notification-turn.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts`
- Coverage audit found no additional proof gap.

## Now

- Rerun stale security/deep audit passes against the explicit dirty worktree.

## Next

- Resolve any accepted audit findings, commit, push, and run ReviewGPT round 12.

## Open questions

- None.

## Working set

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/src/assistant/notification-turn.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
- `packages/assistant-engine/test/assistant-notification-turn-runtime.test.ts`
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
