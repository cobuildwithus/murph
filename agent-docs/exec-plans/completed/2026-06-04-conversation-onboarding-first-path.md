# Conversation onboarding first experiment path

Status: completed
Created: 2026-06-04
Updated: 2026-06-04

## Goal

- Tighten conversation onboarding so onboarding cannot be marked complete until
  the first experiment or logging path is explicitly resolved.

## Success criteria

- `conversation-onboarding` requires a direct first-experiment/logging decision
  before completion.
- The skill explicitly hands off to `experiment-onboarding` when the user
  chooses the experiment path.
- The supplement prompt mentions that the user can send a picture of supplement
  bottles or labels if that is easier.
- Regression tests assert the required completion and handoff language and
  supplement-photo language, and reject the old separate-flow escape hatch.

## Scope

- In scope:
  - `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`
  - `packages/assistant-engine/test/assistant-skill-assets.test.ts`
- Out of scope:
  - Global system prompt rewrites beyond existing skill routing.
  - Experiment-onboarding behavior changes.

## Constraints

- Technical constraints:
  - Keep the skill concise and route through the existing package-owned skill
    assets.
  - Preserve one-question-per-turn onboarding style.
- Product/process constraints:
  - Do not auto-create experiments without user choice.
  - Follow repo verification and completion workflow.

## Risks and mitigations

1. Risk: Prompt wording could imply automatic run creation without consent.
   Mitigation: Define resolved states as created, log-only, deferred/declined,
   or blocked by a specific safety/logistics issue.

## Tasks

1. Update conversation-onboarding outcomes, Step 10, and completion criteria.
2. Add focused assertions to the assistant skill asset test.
3. Run scoped verification and required completion checks.

## Decisions

- Keep the fix in `conversation-onboarding`; `experiment-onboarding` already
  contains the run-creation flow once invoked.

## Verification

- Commands to run:
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/skills/conversation-onboarding/SKILL.md packages/assistant-engine/test/assistant-skill-assets.test.ts`
  - `pnpm typecheck`
  - `git diff --check -- agent-docs/exec-plans/active/2026-06-04-conversation-onboarding-first-path.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/assistant-engine/skills/conversation-onboarding/SKILL.md packages/assistant-engine/test/assistant-skill-assets.test.ts`
- Expected outcomes:
  - All commands pass or any unrelated blocker is recorded with exact scope.
- Completed:
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/skills/conversation-onboarding/SKILL.md packages/assistant-engine/test/assistant-skill-assets.test.ts` passed.
  - `pnpm typecheck` passed.
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-skill-assets.test.ts` passed after review-driven test cleanup.
  - `git diff --check -- agent-docs/exec-plans/active/2026-06-04-conversation-onboarding-first-path.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/assistant-engine/skills/conversation-onboarding/SKILL.md packages/assistant-engine/test/assistant-skill-assets.test.ts` passed.
  - Security/privacy review found no findings.
  - Coverage/proof pass added focused assertions; unrelated assertion drift was removed.
  - Final task-finish review found no findings.
Completed: 2026-06-04
