# First-contact local chat gating

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make Murph's first-contact welcome truly ineligible for local terminal chat sessions that do not have a stable first-contact identity, so prior Telegram or other messaging contact is respected.

## Success criteria

- A `channel: null` local chat session does not inject the first-contact welcome just because it is a new local session.
- First-contact welcome behavior for identifiable messaging channels stays unchanged.
- The gating rule is expressed at the shared planning boundary, not only in one caller.
- Focused regression coverage proves the Telegram-first then local-chat case.

## Scope

- `packages/assistant-engine/**`
- `packages/assistant-cli/**` only if the chosen fix requires caller cleanup
- focused regression tests in affected owner packages

## Constraints

- Preserve unrelated worktree edits, especially concurrent assistant-engine and CLI work.
- Keep first-contact semantics explicit: identifiable messaging contact and local terminal chat are different concepts.
- Prefer a narrow behavior fix over introducing new persisted state or a broader onboarding abstraction.
- Follow the repo-required verification path for assistant-engine changes.

## Plan

1. Tighten first-turn check-in eligibility so missing first-contact state doc ids are ineligible rather than implicitly fresh.
2. Remove any now-misleading caller behavior only if it materially improves clarity without widening scope.
3. Add focused regression tests for both the shared plan seam and the Telegram-first then local-chat behavior.
4. Run required verification plus a direct scenario proof from the relevant tests.
5. Run the required final audit pass, address findings, and land a scoped commit.
Completed: 2026-04-09
