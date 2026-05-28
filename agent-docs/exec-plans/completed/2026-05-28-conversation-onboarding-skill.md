# Conversation Onboarding Skill

## Goal

Move first-run conversation onboarding guidance out of the always-injected assistant prompt and into a Murph-managed assistant skill file, while preserving the existing route flag that tells Codex when onboarding guidance is available.

## Scope

- Add a `conversation-onboarding` package skill under `packages/assistant-engine/skills/**`.
- Register the skill in the assistant skill asset registry with a stable symbolic file reference.
- Replace the inline conversation onboarding body with a concise prompt route hint when onboarding guidance is enabled.
- Add regression tests proving the prompt still points at the skill, does not inline the long onboarding body, and the registered skill file remains valid.

## Non-Goals

- No change to onboarding eligibility, turn planning, completion command semantics, or hosted/local runtime ownership.
- No native Codex skill rendering or runner-local skill path injection.
- No change to experiment onboarding behavior.

## Verification

- Focused assistant-engine prompt/skill tests.
- `pnpm test:diff` for the touched assistant-engine files when truthful.
- `pnpm typecheck`.
Status: completed
Updated: 2026-05-28
Completed: 2026-05-28
