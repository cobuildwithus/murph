Goal (incl. success criteria):
- Remove the stacked dialog-in-dialog email verification flow on /settings: the "Change email" dialog currently opens a second "Enter your verification code" dialog on top of itself while the underlying dialog still shows a redundant pending alert with duplicate Enter code/Resend code buttons.
- Replace it with one dialog and two steps: email entry -> inline code entry, reusing the existing `HostedVerificationCodeStep` OTP component the phone/email auth flows already use.
- Verification code auto-submits when all 6 digits are entered (built into `HostedVerificationCodeStep` via InputOTP `onComplete`).
- Success means: no nested dialog, no duplicate "we sent a code"/"Resend code" affordances, OTP auto-submits, existing send/verify/sync behavior (Privy `useUpdateEmail` + `/api/settings/email/sync`) unchanged.

Constraints/Assumptions:
- `HostedEmailSettings` is only mounted inside `HostedSettingsIdentityLinkDialog`, so the inline two-step swap is safe everywhere it renders.
- No auth/session behavior change: same Privy sendCode/verifyCode calls, same sync route; this is UI restructuring plus auto-submit.
- Default to deletion: remove `HostedEmailVerificationDialog`, the pending alert, and the `dialogOpen`/`effectiveDialogOpen` controller state instead of layering new state.

Key decisions:
- Mirror `HostedEmailAuthButton`'s proven pattern: `pendingEmailAddress` gates the step swap; code input read through a ref on submit so auto-submit never reads stale state.
- Resend while in the code step targets `pendingEmailAddress` directly (the email input is no longer rendered in that step), matching the auth-button flow.
- Add a "Use another email" secondary action that clears the pending state and returns to step 1.

State:
- Complete; ready for finish-task commit and PR.

Done:
- Root-cause analysis of the stacked dialogs (page-section component reused inside a dialog, bringing its own modal).
- Implemented the inline two-step swap and controller cleanup (dialog state, email-coupled resend, dead code normalization removed).
- Established harness fact: linkedom cannot drive React synthetic onChange, so InputOTP auto-submit is exercised in production by the shared phone-flow component, and tests drive the same onSubmit callback through the verify button.
- frontend-review fixes: drained input-otp's uncleared 0-50ms timers in afterEach (unhandled-error noise gone), dropped size="compact" for OTP size parity with the phone flow in the same dialog, focus restore after "Use another email", silent unreachable resend guard, clear code on verify failure. Rejected as pre-existing parity/old-behavior polish: stale outer dialog description during step 2; brief form flash during post-verify sync.
- coverage-write additions: empty-code guard + whitespace-trim test, submitting-state disabled/label test, strengthened resend test; focused file 15/15 with no unhandled errors.
- task-finish-review: no material findings; residual is the manual browser pass below.
- Verification: pnpm test:diff green on final state (full apps/web verify: next build, 255 test files / 2216 tests, eslint, dev smoke).

Now:
- finish-task commit, push, PR.

Next:
- Manual browser pass of the /settings change-email dialog (auto-submit on 6th digit, cleared code after failure, resend, focus restore on "Use another email").

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/components/settings/hosted-email-settings-sections.tsx
- apps/web/src/components/settings/hosted-email-settings.tsx
- apps/web/src/components/settings/hosted-email-settings-controller.ts
- apps/web/test/settings-email-settings.test.ts
- pnpm test:diff apps/web/src/components/settings apps/web/test/settings-email-settings.test.ts
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
