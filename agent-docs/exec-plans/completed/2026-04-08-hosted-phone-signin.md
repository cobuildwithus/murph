# Hosted Phone Sign-In

## Goal

Add a simple hosted dialog for existing-account phone-code sign-in that matches the current signup flow style, while refactoring the hosted phone auth UI into more composable pieces instead of duplicating signup logic.

## Why

- Users currently have a phone signup path but no equally direct way to log into an existing account with phone + code.
- The current hosted phone auth implementation already contains most of the send-code / enter-code / authenticated-state behavior; extending it cleanly should reduce auth UI drift.

## Scope

- Hosted web onboarding auth components under `apps/web/src/components/hosted-onboarding/**`
- Hosted landing and invite entry points that render the phone auth UI
- Focused hosted-web tests covering the new sign-in path and any view/state refactor

## Constraints

- Preserve existing signup and invite flows.
- Reuse current Privy-backed phone auth behavior rather than introducing a second auth stack.
- Keep the UI simple: phone input, send code, enter code, then continue.
- Preserve unrelated in-progress hosted auth edits in the dirty worktree.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Direct scenario proof from the rendered component/test flow for existing-account sign-in

## Notes

- This is an auth-facing hosted-web change, so keep the diff narrow and bias toward composable shared view primitives instead of new parallel components.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
