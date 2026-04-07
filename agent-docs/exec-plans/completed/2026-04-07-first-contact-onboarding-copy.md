# Update first-contact onboarding copy and prompt sequencing

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Update Murph's first-contact onboarding so the initial welcome ends with a simple readiness prompt, then move the name-and-goals question into the next onboarding turn guidance.

## Success criteria

- The first-contact welcome message ends with `Ready to get started?`.
- The first-turn system prompt instructs Murph to ask `What should I call you, and what are your health goals right now?` as the next onboarding-turn follow-up instead of including it in the initial welcome.
- Assistant-engine verification for the touched package passes.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant/first-contact-welcome.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- Out of scope:
- Broader onboarding flow redesigns or new onboarding state machinery.
- Changes to hosted web, setup CLI, or unrelated assistant behavior.

## Constraints

- Technical constraints:
- Preserve existing first-contact delivery wiring and dedupe behavior; copy changes should flow through existing reuse of the welcome constant.
- Product/process constraints:
- Keep onboarding brief, orienting, and aligned with the product constitution's calm companion tone.
- Follow repo completion workflow, including focused verification and final audit review.

## Risks and mitigations

1. Risk: The system prompt may still steer the model toward the old single-message onboarding.
   Mitigation: Update the first-turn guidance text alongside the welcome constant so the sequencing is explicit.
2. Risk: Exact-copy assertions may fail in assistant-engine tests or delivery checks.
   Mitigation: Search for pinned welcome text before editing and run package-focused verification after the patch.

## Tasks

1. Update the active plan and coordination ledger for this narrow assistant-engine copy task.
2. Patch the first-contact welcome message and first-turn onboarding guidance to reflect the new sequencing.
3. Run focused verification for the touched assistant-engine package plus repo package verification.
4. Close the plan and commit the scoped diff.

## Decisions

- Reuse the existing `ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE` constant for the shorter initial note instead of introducing a second message constant, and express the next-turn question only in system-prompt guidance.
- Keep the earlier light-touch `Want to kick things off?` follow-up guidance in the system prompt in addition to the new explicit separate onboarding-step question.
- Skip the completion-workflow audit subagent because the user explicitly instructed not to run that review and to commit quickly.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine test`
- Expected outcomes:
- Repo typecheck and package test lanes complete successfully, or any unrelated pre-existing failure is called out explicitly with evidence.
- Outcomes:
- `pnpm typecheck` passed.
- `pnpm test:packages` passed when run sequentially. An earlier failure during this task was caused by running it in parallel with `pnpm typecheck`, which interfered with `packages/contracts` build outputs.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test` passed.
Completed: 2026-04-07
