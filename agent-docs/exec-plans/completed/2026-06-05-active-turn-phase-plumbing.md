# Active Turn Phase Plumbing Deletion

Created: 2026-06-05

## Goal

Finish PR #44's active-turn replay deletion by removing the now-vestigial
single-value active-turn phase plumbing.

Success criteria:

- `AssistantTurnInputRefreshInput` no longer carries a `phase` field.
- `AssistantActiveTurnInputAdmissionInput` no longer carries a `phase` field.
- Refresh/admission callers pass only real data: signal, session id, turn id,
  vault, and known input/projection ids.
- Tests assert lifecycle behavior and call counts instead of the deleted
  `'input_available'` value.
- The PR keeps the active-turn invariant: one Murph provider request per turn,
  live same-conversation input through Codex `turn/steer`, and strict targeted
  stale active-turn input failure.

## Scope

Primary implementation files:

- `packages/assistant-engine/src/assistant/turn-input.ts`
- `packages/assistant-engine/src/assistant/input-source.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-controller.ts`
- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/run-loop.ts`
- `packages/assistant-engine/src/assistant/automation.ts`

Primary proof files:

- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
- `packages/assistant-engine/test/assistant-automation-runtime.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`

Docs already updated by the broader PR remain in scope for final drift checks:

- `ARCHITECTURE.md`
- `agent-docs/index.md`
- `agent-docs/references/hosted-runtime-protocol.md`

## Non-Goals

- Do not add a replacement phase enum or admission abstraction.
- Do not change hosted runtime phase-boundary logging; that is unrelated.
- Do not alter active-turn durability/checkpoint semantics.

## Verification

Focused checks already run:

- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-engine test -- test/assistant-local-service-runtime.test.ts test/assistant-automation-runtime.test.ts`
- `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-turn-input.test.ts test/hosted-runtime-workspace-runner.test.ts`

Final checks still required before push:

- `pnpm typecheck`
- `pnpm test:diff`
- `pnpm docs:drift`
- `git diff --check`

## Status

Implementation is complete. Final verification and required completion audits
are in progress.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
