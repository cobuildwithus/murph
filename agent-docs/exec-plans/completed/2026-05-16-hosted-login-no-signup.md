# Hosted Login No-Signup

## Goal

Prevent public login-mode auth from creating a new hosted Murph member when the
verified Privy identity does not already resolve to an existing member.

Success criteria:

- Login CTA auth sends Privy code/link requests in no-signup mode.
- Login completion fails with the existing "finish signup from your latest
  Murph link" path instead of creating a new member.
- Signup and invite-bound auth still create/reconcile members as before.
- Focused hosted-web tests cover login-mode email behavior and server-side
  completion gating.

## Scope

- Hosted web auth dialog/client completion state.
- Hosted Privy completion route/service member-creation policy.
- Focused hosted-web tests.

## Constraints

- Do not treat an iMessage email handle as verified email ownership unless
  Privy verifies it.
- Keep invite-bound iMessage email recovery working through the invite code.
- Do not expose raw emails, phone numbers, member ids, Privy ids, or secrets in
  logs/docs beyond synthetic test fixtures.

## Verification

- Focused hosted-web tests for touched auth flows.
- `pnpm typecheck`.
- Wider app verification if focused checks do not provide enough signal.
Status: completed
Updated: 2026-05-16
Completed: 2026-05-16
