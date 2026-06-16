# Onboarding Resume Context

## Goal

Add one read-only assistant onboarding resume-context command so Murph can inspect first-run setup state in a single CLI call instead of running separate vault reads for memory, goals, regimens, supplements, conditions, allergies, experiments, and device accounts.

## Constraints

- Keep the command narrow, read-only, and assistant-owned.
- Preserve the existing onboarding rule: visible conversation context stays first; resume-context is only for missing prior onboarding history.
- Avoid `packages/assistant-engine/src/assistant/system-prompt.ts` because another active lane owns that file.
- Do not add speculative persistence or new vault state.

## Working Set

- `packages/assistant-cli/src/commands/assistant.ts`
- `packages/assistant-engine/skills/murph-onboarding/SKILL.md`
- `packages/assistant-engine/src/assistant/cli-surface-bootstrap.ts`
- Relevant assistant-cli and assistant-engine tests

## Plan

1. Add compact resume-context output schema and command under `assistant onboarding`.
2. Expose the command in the assistant CLI surface where appropriate.
3. Update onboarding skill guidance and regression tests.
4. Run scoped package verification and completion checks.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
