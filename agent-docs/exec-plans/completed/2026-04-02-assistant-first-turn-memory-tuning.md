# Assistant First-Turn And Memory Tuning

## Goal

Reduce confusing onboarding behavior in first-contact assistant replies by moving the behavior into prompt instructions only, so lightweight chat does not default into onboarding or memory bookkeeping and the runtime does not hardcode message-text matching.

## Scope

- Keep first-turn runtime injection generic and avoid hardcoded message-text matching in `packages/assistant-core/src/assistant/provider-turn-runner.ts`.
- Update the centralized prompt wording in `packages/assistant-core/src/assistant/system-prompt.ts` so first-turn check-ins are instruction-driven and memory is selective rather than broadly proactive.
- Adjust focused assistant-service tests so they verify behavior and key concepts without depending on brittle full-sentence prompt copy.

## Constraints

- Preserve the centralized prompt seam landed in the previous patch.
- Keep the change limited to prompt behavior and first-turn gating; do not widen into broader assistant architecture or tool-surface changes.
- Preserve unrelated dirty worktree edits and call out unrelated baseline verification failures explicitly.

## Verification

- `pnpm build:test-runtime:prepared`
- `pnpm exec vitest run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- `pnpm --dir packages/assistant-core typecheck`
- `pnpm --dir packages/cli typecheck`

## Outcome

- Kept first-turn runtime injection generic so the follow-up remains prompt-driven rather than relying on hardcoded message-text matching.
- Reworded the centralized prompt so first-turn check-ins are optional, limited to greeting-style/vague openers by instruction, skipped for concrete asks, and explicitly barred from triggering memory actions just because it is the first turn.
- Softened memory guidance so lightweight chat replies directly, memory search is conditional, and proactive writes are limited to clearly durable user-stated facts.
- Refactored the focused assistant-service assertions into small helper checks so prompt tests verify concepts and gating instead of exact sentence copy.
- `pnpm build:test-runtime:prepared`, focused assistant tests, and the assistant-core and CLI package typechecks passed.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
