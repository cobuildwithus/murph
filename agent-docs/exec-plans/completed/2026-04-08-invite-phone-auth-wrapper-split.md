# Goal (incl. success criteria):
- Move invite-only phone-code orchestration out of the shared hosted phone auth component so homepage/public auth uses one generic phone-entry/code-verification flow and the invite page owns its shortcut/manual-entry logic.
- Preserve current invite behavior, including invite-specific send-code, fallback to manual entry, and post-verification invite status handling, while simplifying shared auth ownership.

# Constraints/Assumptions:
- This is an auth/user-facing refactor inside `apps/web`, so preserve current Privy/local-storage auth transport and avoid expanding scope into broader auth redesign.
- Preserve unrelated in-flight edits in the hosted auth files and the existing dirty worktree outside this task.
- Keep the diff proportional: prefer moving invite logic into the existing invite wrapper over introducing new generic abstractions unless the move clearly requires them.

# Key decisions:
- `HostedPhoneAuth` should become manual phone entry + SMS code verification only; it should no longer own invite shortcut branching.
- Invite-specific shortcut visibility, invite send-code calls, and manual-entry fallback should live in `JoinInviteVerificationPanel` / invite wrapper files.
- Keep the existing shared Privy completion path and invite status state machine; only change where the invite-specific client orchestration lives.

# State:
- completed

# Done:
- Reviewed the current homepage, invite page, shared phone auth controller, and invite status files to confirm the current seam and the minimum viable refactor.
- Confirmed the shared auth controller still owns invite-only branches (`mode`, `handleInviteSendCode`, invite resend target logic) that should move upward.
- Moved invite-only shortcut send-code, resend routing, and manual-entry fallback into a dedicated `HostedInvitePhoneAuth` wrapper while shrinking shared `HostedPhoneAuth` to the public manual phone-entry/code flow.
- Removed invite/public mode branching from the shared auth flow types and views, and re-extracted a shared auth shell so invite and public wrappers no longer duplicate top-level error/authenticated-state rendering.
- Removed the now-unused `inviteCode` prop from the public `HostedPhoneAuth` surface and updated homepage/sign-in callers to use the narrower API.
- Updated focused hosted-web tests for the new wrapper seam and added explicit invite-wrapper coverage for shortcut send, resend from the code step, and `SIGNUP_PHONE_UNAVAILABLE` manual fallback.
- Scoped verification passed:
  - `pnpm --config.verify-deps-before-run=false exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-phone-auth.test.ts apps/web/test/join-invite-client.test.ts apps/web/test/page.test.ts`
  - `pnpm --config.verify-deps-before-run=false --dir apps/web typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir apps/web lint` (warnings only, pre-existing)
- Required simplify review found duplicated wrapper shells; fixed locally by extracting `HostedPhoneAuthScaffold`.
- Required final review found a wrapper coverage gap; fixed locally by adding focused invite-wrapper tests and re-running scoped verification.

# Now:
- Close the plan and create the scoped commit.

# Next:
- None.

# Open questions (UNCONFIRMED if needed):
- No open implementation questions.
- Direct proof gap: no manual browser pass was run for the invite flow.

# Working set (files/ids/commands):
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-step-views.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-views.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-types.ts`
- `apps/web/src/components/hosted-onboarding/hosted-invite-phone-auth.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-stage-panels.tsx`
- `apps/web/src/components/homepage/homepage-auth-panel.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-existing-account-sign-in-dialog.tsx`
- `apps/web/test/hosted-phone-auth.test.ts`
- `apps/web/test/join-invite-client.test.ts`
- `apps/web/test/page.test.ts`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
