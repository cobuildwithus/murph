# Murph Onboarding Continuation Prompt

## Goal

Keep first-run Murph onboarding moving after the user sends onboarding-relevant context such as labs or supplement labels, while still handling the user's immediate request first.

## Scope

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant-skill-assets.ts`
- `packages/assistant-engine/skills/murph-onboarding/SKILL.md`
- `packages/assistant-engine/test/model-behavior.test.ts`
- `packages/assistant-engine/test/assistant-skill-assets.test.ts`
- `packages/assistant-engine/test/assistant-protocol-index-planning.test.ts`

## Constraints

- Prefer a prompt-only fix.
- Remove confusing "concrete help" emphasis where possible.
- Preserve safety-sensitive and explicit no-follow-up skip behavior.
- Do not introduce new onboarding persisted state or a step tracker.

## Verification

- Focused assistant-engine prompt and skill asset tests.
- `pnpm typecheck`.
- Required prompt-review completion audit.
Status: completed
Updated: 2026-06-08
Completed: 2026-06-08
