# Guard hosted invite verify UI until auth status rehydrates

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Prevent the join page from showing the stale pre-verification phone flow after a user already completed phone verification and returned from Stripe checkout.
- Keep the backend invite/send-code contract unchanged by resolving the mismatch at the client status-hydration layer.

## Success criteria

- The join page does not render the invite send-code shortcut while Privy auth is still settling on a verify-stage invite.
- Authenticated returning users refresh into checkout, active, or mismatch states without hitting `SIGNUP_PHONE_UNAVAILABLE`.
- Focused hosted-web tests cover the stale verify-stage render guard.
- Required hosted-web verification and final review complete cleanly, or any unrelated failures are documented.

## Scope

- In scope:
- `apps/web/src/components/hosted-onboarding/join-invite-client.tsx`
- `apps/web/test/join-invite-client.test.ts`
- Repo workflow artifacts for this task
- Out of scope:
- Backend invite-service behavior
- Stripe cancel-route behavior beyond the invite-page UX after return

## Constraints

- Technical constraints:
- Preserve the current invite status contract and existing Privy session refresh flow.
- Do not add new persisted state or backend-only flags for this UX correction.
- Product/process constraints:
- Keep the verify-state copy neutral while preventing the wrong action from appearing.
- Preserve unrelated hosted-web worktree edits.

## Risks and mitigations

1. Risk: A loading guard could strand users on a spinner if the auth-backed status refresh fails.
   Mitigation: Surface a retryable status-check error state instead of silently falling back to the stale send-code button.

## Tasks

1. Register the task in the coordination ledger and inspect the current invite/session refresh path.
2. Add a verify-stage auth-settling guard in the join invite client.
3. Add focused tests for unauthenticated, auth-settling, and stale-authenticated verify states.
4. Run required verification, complete the required final review, and commit the scoped diff.

## Decisions

- Keep `/api/hosted-onboarding/invites/:inviteCode/send-code` unchanged; the bug is stale client rendering, not backend eligibility logic.
- Prefer a status-refresh loading state on the join page over routing authenticated users back through the phone-auth flow.
- Add a retryable status-refresh error panel rather than silently falling back to the stale send-code shortcut when the auth-backed refresh fails.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web test -- apps/web/test/join-invite-client.test.ts`
- Expected outcomes:
- Hosted-web invite tests and broader required checks pass without changing backend onboarding behavior.

## Outcome

- Implemented a verify-stage auth-settling guard in the join invite client plus a retryable status-refresh error state.
- Added focused hosted-web tests for unauthenticated, not-ready, and already-authenticated verify-stage renders.
- Required checks completed with unrelated pre-existing repo failures outside this diff:
  - `pnpm typecheck`: fails in `packages/assistantd/vitest.config.ts` because `coverage` is not recognized on `ProjectConfig`.
  - `pnpm test:coverage`: fails in `packages/assistant-engine/test/workout-facade-primitives.test.ts` (missing `../src/usecases/workout.js`) and `packages/cli/test/assistant-core-facades.test.ts` (owner dependency assertion).
- Focused hosted-web proof passed: `pnpm --dir apps/web test -- apps/web/test/join-invite-client.test.ts`.
Completed: 2026-04-08
