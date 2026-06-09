# Experiment session support loop

## Goal

Land a prompt-level correction so experiment session support closes the loop without asking the user to remember future reporting chores.

Success criteria:

- Experiment onboarding skill states the session-support outcome, stop/skip behavior, pre-bed wake-window handling, one-shot automation shape, and missed-log due-check command.
- Notification prompt tells session-support automations to check saved experiment/protocol/progress before sending, treat pre-bed sessions as the prior local session date, and avoid "remember to log later" wording.
- Prompt-contract tests cover the new outcome-critical text.
- No new scheduler abstraction, schema, persisted state, or runtime expansion is introduced.

## Scope

- In: `packages/assistant-engine/skills/experiment-onboarding/SKILL.md`, notification prompt text in `packages/assistant-engine/src/assistant/system-prompt.ts`, and focused prompt-contract tests.
- Out: automation runtime changes, experiment due-logic expansion for irregular schedules, schema changes, and new reminder primitives.

## Constraints

- Preserve unrelated dirty work.
- Keep this as a prompt-primary change and use the prompt-review completion path.
- Keep retrieval-budget instructions compact and explicit.
- Avoid direct personal identifiers in committed artifacts.

## Plan

1. Inspect current prompt surfaces and tests.
2. Patch the session-support and first-session-prep wording.
3. Add focused prompt-contract assertions.
4. Run scoped package verification plus typecheck.
5. Run prompt-review, resolve findings, then close with `scripts/finish-task`.

## Completion Notes

- Added the session-support outcome block to `experiment-onboarding`.
- Updated notification guidance so session-support automations close the loop, use bounded retrieval, distinguish pre-session guidance from after-session missed-log recovery, and carve out session-support from generic due-check/default-skip rules.
- Added prompt-contract assertions for the session-support outcome, pre-bed wake-window handling, stable slugs, dated missed-log due checks, notification retrieval budget, and default-skip carve-outs.
- Prompt-review found and fixed two precedence/phase conflicts; final recheck found no remaining issues.

## Verification

- `pnpm exec vitest run packages/assistant-engine/test/experiment-onboarding-skill-guidance.test.ts packages/assistant-engine/test/model-behavior.test.ts --config vitest.config.ts --no-coverage` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/skills/experiment-onboarding/SKILL.md packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/experiment-onboarding-skill-guidance.test.ts packages/assistant-engine/test/model-behavior.test.ts` passed.
- `pnpm typecheck` passed.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
