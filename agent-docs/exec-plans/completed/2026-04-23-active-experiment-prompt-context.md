# Active Experiment Prompt Context

## Goal

Inject a small, dynamic active-experiment context block into assistant prompts so Murph can notice ongoing experiment runs without treating prompt text as source-of-truth state.

Success criteria:

- Active experiment awareness is generated from canonical vault/query data per turn.
- No new persisted assistant runtime state is introduced.
- Prompt context is capped, privacy-gated, and explicitly labeled as navigation-only.
- The assistant is still instructed to query experiment progress before interpretation, reminders, or outcome claims.
- Focused tests cover rendering, filtering, prompt inclusion, and runner failure/privacy behavior.

## Scope

- `packages/assistant-engine/src/assistant/**`
- Directly coupled `packages/assistant-engine/test/**`

## Constraints

- Preserve existing prompt-builder architecture.
- Do not widen into Health Commons protocol onboarding behavior, CLI command surfaces, or persisted state.
- Do not touch unrelated dirty work in `packages/cli/**` or unrelated active lanes.

## Current Plan

1. Add a helper that renders active experiments from `readVault`.
2. Add optional active-experiment context fields to assistant system prompt inputs.
3. Resolve the block per provider turn only when sensitive context is allowed.
4. Add focused tests and run scoped verification.

## Verification

Passed:

- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-active-experiment-context.test.ts test/system-prompt.test.ts test/provider-turn-runner.test.ts --config vitest.config.ts --no-coverage`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/active-experiment-context.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/test/assistant-active-experiment-context.test.ts packages/assistant-engine/test/system-prompt.test.ts packages/assistant-engine/test/provider-turn-runner.test.ts`
Status: completed
Updated: 2026-04-23
Completed: 2026-04-23
