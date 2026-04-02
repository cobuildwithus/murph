# Resolved Target Reasoning Capability

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Stop treating assistant reasoning effort as a fixed provider-family capability when the actual support depends on the resolved backend target.
- Make setup, the assistant model catalog, and chat metadata reflect the same OpenAI-target reasoning support that the runtime already forwards on the Responses path.

## Success criteria

- Setup no longer blanket-rejects `assistantReasoningEffort` for every `openai-compatible` target.
- Target capability resolution is based on the normalized assistant backend config, not only the provider enum.
- Official OpenAI-backed `openai-compatible` targets surface reasoning support consistently in the model catalog and chat metadata.
- Focused tests cover setup acceptance/rejection and the target-aware catalog or metadata behavior.

## Scope

- `packages/assistant-core/src/assistant/{provider-config.ts,provider-registry.ts,providers/{registry.ts,types.ts}}`
- `packages/cli/src/{assistant/{provider-catalog.ts,ui/{ink.ts,view-model.ts}},setup-assistant.ts}`
- Focused tests under `packages/cli/test/{assistant-provider.test.ts,assistant-runtime.test.ts}`

## Constraints

- Preserve unrelated worktree edits, especially active assistant backend-target flattening changes.
- Keep the change narrow to reasoning-effort truthfulness; do not widen into broader provider refactors.
- Prefer a resolved-target capability helper over duplicating endpoint checks in setup, UI, and tests.

## Verification plan

- Focused assistant tests while iterating:
  - `pnpm exec vitest run --no-coverage packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts`
- Direct scenario proof:
  - `pnpm exec tsx --eval ...` to confirm the setup resolver accepts official OpenAI reasoning effort and rejects non-OpenAI-compatible targets
- Required repo commands before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion audit:
  - `task-finish-review`
Completed: 2026-04-02
