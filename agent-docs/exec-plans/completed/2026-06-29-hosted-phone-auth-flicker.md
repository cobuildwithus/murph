Goal (incl. success criteria):
- Debug and fix the hosted phone auth state-machine flicker where a first-time phone signup briefly returns to the phone-number input after a verification code is accepted.
- Success means the UI stays in the verified/finalizing state while hosted Privy completion and account creation finish, with regression coverage for the transition.

Constraints/Assumptions:
- Preserve hosted auth/session authority boundaries; Privy remains fresh proof and Murph app-session creation remains server-owned.
- Keep the fix narrow and avoid adding new persisted state or broad auth abstractions.
- Do not expose direct personal identifiers, secrets, raw phone numbers, or local paths in committed artifacts.

Key decisions:
- Root cause: the controller suppressed `authenticatedView` whenever `pendingAction === "verify-code"`. When Privy accepted the SMS code and flipped the browser to authenticated before hosted completion/navigation finished, the scaffold rendered child auth flow content instead of the existing finalizing state.
- Fix at the state-machine edge: treat `authenticated && pendingAction === "verify-code"` as a finalizing/loading state, without changing server completion/session authority.
- Deep review found a parent preemption path: after `onCodeSent`, a transient authenticated email/Telegram-only Privy snapshot could make `HostedAuthPanel` render the resumable-auth branch and unmount the phone controller before its finalizing state rendered.
- Parent fix: suppress resumable-auth takeover after the phone flow has sent a code, keeping the phone flow mounted until it completes, fails, or the user explicitly changes number.

State:
- Active.

Done:
- Loaded required repo routing, architecture, frontend, verification, security, and product docs.
- Located the hosted phone auth controller/test surface.
- Patched `hosted-phone-auth-controller.ts` to keep finalizing UI visible during post-code authenticated completion.
- Patched `hosted-auth-panel.tsx` to keep resumable auth from replacing an active SMS verification flow.
- Added focused regression coverage in `hosted-phone-auth.test.ts`.
- Added panel-level regression coverage in `hosted-auth-panel.test.ts`.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-onboarding-integrations apps/web/test/hosted-phone-auth.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-auth-panel.test.ts`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts apps/web/test/hosted-phone-auth.test.ts`
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts apps/web/src/components/hosted-onboarding/hosted-auth-panel.tsx apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-auth-panel.test.ts`
  - `pnpm --dir apps/web dev:smoke`
  - `git diff --check`
- Security/privacy audit found no medium-or-higher findings.
- Deep review finding resolved locally.

Now:
- Final review and scoped commit.

Next:
- Finish/commit the active plan.

Open questions (UNCONFIRMED if needed):
- None currently.

Working set (files/ids/commands):
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- `apps/web/src/components/hosted-onboarding/hosted-auth-panel.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-step-views.tsx`
- `apps/web/test/hosted-phone-auth.test.ts`
- `apps/web/test/hosted-auth-panel.test.ts`
Status: completed
Updated: 2026-06-29
Completed: 2026-06-29
