# Require conversation onboarding context persistence

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Fix the conversation onboarding workflow gap where useful setup answers can mark onboarding complete without being persisted as canonical memory or goals.

## Success criteria

- The conversation onboarding skill requires canonical persistence for preferred name/nickname and health interests/goals before completing onboarding when the user supplied those answers.
- The skill keeps `assistant onboarding complete` as a runtime lifecycle flag only, not the persistence mechanism.
- Tests pin the skill guidance so future prompt changes do not drop the persistence requirement.

## Scope

- In scope: `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`, focused assistant skill asset tests.
- Out of scope: new canonical storage primitives, hosted web onboarding schema changes, broad assistant command redesign.

## Constraints

- Technical constraints: canonical memory and goal writes must use existing `vault-cli memory upsert` and `vault-cli goal save` surfaces; assistant runtime state must not become product truth.
- Product/process constraints: do not save data when the user clearly declines; avoid turning onboarding into a questionnaire.

## Risks and mitigations

1. Risk: The assistant saves vague interests as rigid goals.
   Mitigation: Instruct concrete goal-like answers to use goal records and softer context/interests to use memory.
2. Risk: Onboarding closes even when persistence failed.
   Mitigation: Instruct completion only after successful required canonical writes, with a user-visible warning if persistence fails.

## Tasks

1. Confirm root cause in the current onboarding skill and lifecycle command.
2. Update the skill outcome/completion rules to require canonical memory/goal writes.
3. Add focused test coverage for the new skill guidance.
4. Run focused package tests and typecheck/required verification.

## Decisions

- Root cause is a workflow gap, not a privacy block: the current completion command only writes `.runtime/operations/assistant/state/onboarding/conversation.json`.

## Verification

- `pnpm --dir packages/assistant-engine test assistant-skill-assets.test.ts` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/skills/conversation-onboarding/SKILL.md packages/assistant-engine/test/assistant-skill-assets.test.ts` passed.
- `git diff --check -- agent-docs/exec-plans/active/2026-06-02-onboarding-context-persistence.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md packages/assistant-engine/skills/conversation-onboarding/SKILL.md packages/assistant-engine/test/assistant-skill-assets.test.ts` passed.
- Identifier/secret scan over touched task files found no direct identifiers or sensitive token leaks beyond existing negative test assertions.
Completed: 2026-06-02
