# Hosted Onboarding Privy UX

## Goal

Resolve or clearly isolate the confusing hosted onboarding Privy modal UX where a login-only phone/SMS failure can appear alongside a pending/resume sign-in state.

Success criteria:

- Identify whether the confusing copy is app-owned or rendered by Privy.
- Keep the server onboarding-completion `403` path out of this pass; the current report says that failure is caused by not running the root dev stack.
- If the stale pending state is app-controllable, make the smallest client-side fix.
- Add focused tests for any changed app-owned behavior.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Do not log raw phone numbers, IDs, cookies, auth tokens, or Privy payloads.
- Do not change invite-gating or hosted onboarding completion eligibility in this pass.
- Prefer app-owned state cleanup over custom-copy workarounds unless the code shows the copy is ours.

## Current State

- User reports contradictory UI after a failed login-only/no-signup attempt: "account not found" plus "you already started signing in."
- User clarified the later signup completion failure is expected locally when the root dev stack is not running.

## Working Set

- `apps/web` hosted onboarding auth/Privy client surfaces.
- Focused hosted onboarding tests directly coupled to the changed surface.
Status: completed
Updated: 2026-04-27
Completed: 2026-04-27
