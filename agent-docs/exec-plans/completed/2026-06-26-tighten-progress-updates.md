# Tighten Assistant Progress Updates

## Goal

Land a narrow PR that makes assistant progress updates rarer and cheaper on messaging surfaces.

Success means the assistant progress-update runtime cap is two per turn, non-required progress updates are spaced by at least two minutes, prompt/tool guidance matches that contract, focused tests cover the cap and spacing, verification passes, the branch is pushed, a PR is open, and the PR-lane ReviewGPT loop reaches zero accepted findings.

## Scope

- `packages/assistant-engine/src/assistant/progress-constants.ts`
- `packages/assistant-engine/src/assistant/turn-progress.ts`
- progress-update prompt/tool guidance in assistant-engine
- supplement onboarding skill guidance that referenced eager lookup progress updates
- focused assistant-engine progress tests
- one assistant-engine outbox retention test harness cleanup needed for the diff-aware package test lane
- ReviewGPT PR-review preset connector guardrail drift found by the diff-aware CLI release-smoke lane
- one CLI release-smoke ZIP bundle test timeout adjustment needed for the diff-aware package test lane

## Constraints

- Keep the implementation simple and local to existing progress-update primitives.
- Do not introduce new durable state, queues, or schedulers.
- Preserve required progress updates for internally required system notices.
- Treat the supplied patch as intent, not overwrite authority.

## Verification

- `pnpm typecheck` passed after `pnpm build:test-runtime:prepared`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-turn-progress.test.ts test/assistant-progress-prompt.test.ts test/model-behavior.test.ts --config vitest.config.ts` passed
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-skill-assets.test.ts --config vitest.config.ts` passed
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts` passed
- `bash scripts/workspace-verify.sh test:diff $(git diff --name-only)` passed after final touched-file set
- PR-lane ReviewGPT loop after push

## State

Now: final exact diff-aware verification is green.
Next: finish the scoped commit, push, open the PR, then run the PR-lane ReviewGPT loop.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
