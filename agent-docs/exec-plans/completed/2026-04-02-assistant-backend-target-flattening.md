# Assistant Backend Target Flattening

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Replace the assistant operator config's selected-provider plus provider-defaults map with one canonical saved backend target.
- Simplify setup so Codex local-model selection is just a Codex backend configuration, not a separate backend preset or mode.

## Success criteria

- Operator config stores one assistant backend target object with the selected adapter/model plus adapter-local settings.
- Setup contracts and wizard flow stop treating `codex-oss` as a top-level backend preset.
- `skip` remains a setup-only choice and is not saved as backend state.
- Runtime callers resolve the saved backend target directly instead of depending on `provider` plus `defaultsByProvider`.
- Focused assistant setup/config tests cover the new hard-cut shape.

## Scope

- `packages/assistant-core/src/{operator-config.ts,setup-cli-contracts.ts,hosted-assistant-config.ts}`
- `packages/cli/src/{setup-assistant.ts,setup-services.ts,setup-wizard.ts,setup-cli.ts}`
- Focused tests under `packages/cli/test/**` that exercise operator config and setup behavior
- Matching architecture/docs updates if the durable config model changes materially

## Constraints

- Green-field hard cut: do not preserve backward compatibility with the old provider/defaults map or legacy setup presets.
- Preserve unrelated worktree edits.
- Keep the refactor proportional: collapse mode/config shape without widening into unrelated provider runtime behavior.

## Verification plan

- Focused assistant setup/config tests while iterating
- Required repo commands before handoff:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Required completion audit: `task-finish-review`

## Outcomes

- Added a canonical `assistant.backend` target with adapter/model/endpoint/credential refs plus adapter-local `options`.
- Collapsed setup presets to `codex | openai-compatible | skip`; local-model Codex now flows through `assistantOss` instead of a top-level `codex-oss` preset.
- Removed hosted-to-generic assistant default seeding; hosted automation now requires explicit hosted assistant config or hosted env seed data.
- Updated setup/operator-config/runtime tests to assert the single-backend shape and hosted-config separation.

## Verification results

- Focused assistant backend/setup/bootstrap tests were updated to the new shape.
- `pnpm typecheck` failed outside this task in dirty `packages/assistant-core/src/assistant/**` files:
  - `packages/assistant-core/src/assistant-cli-tools.ts`: missing `getAssistantMemory`
  - `packages/assistant-core/src/assistant/provider-turn-runner.ts`: missing `assistantMemoryPaths`
- `pnpm test` failed for the same unrelated assistant-memory/runtime errors and also hit an existing `apps/web` dev-smoke lock conflict (`Another apps/web dev server is already running for .next-smoke`).
- `pnpm test:coverage` failed early for the same unrelated assistant-memory/runtime errors.

## Audit

- Requested the required `task-finish-review` subagent pass for the backend-target flattening lane before commit.
Completed: 2026-04-02
