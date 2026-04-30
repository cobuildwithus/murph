# /join Consent at Code Verification Completion

## Goal

Move the `/join` launch consent ask to the phone-code verification completion boundary so first-contact SMS users accept required launch legal/health-data consent after proving phone ownership and before pricing/messaging/active continuation.

## Scope

- `/join` invite client status gating and stage rendering.
- Hosted invite phone verification completion handling.
- Focused `/join` and hosted phone auth tests.

## Constraints

- Preserve homepage auth consent cleanup: no duplicate passive legal copy inside phone auth.
- Do not reintroduce consent before sending a phone code.
- Do not bundle unrelated hosted onboarding layout or broader `/join` redesign work.
- Preserve unrelated dirty work in the shared checkout.

## Verification Plan

- Focused hosted-web Vitest for `/join` invite client and hosted phone auth.
- `git diff --check` on touched files.
- Hosted-web typecheck if current unrelated blockers allow it; otherwise report the blocker.

## State

- Completed. Focused auth/join tests and diff-check passed. Hosted-web typecheck is currently blocked by unrelated dirty device-sync type errors after initially passing earlier in the turn.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
