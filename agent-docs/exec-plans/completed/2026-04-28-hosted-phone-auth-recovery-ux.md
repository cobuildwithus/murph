Goal (incl. success criteria):
- Make hosted phone sign-in recovery avoid showing a destructive error alert alongside the authenticated manual-resume card.
- Preserve the recovery actions: continue with the current session or sign out/use a different number.

Constraints/Assumptions:
- Preserve unrelated dirty work in the current checkout.
- This is a user-facing hosted auth UX change; do not alter server auth authority or Privy account-linking behavior.
- Client components remain browser interaction surfaces only.

Key decisions:
- Treat manual-resume as the primary recovery state and suppress stale/generic error chrome while it is visible.

State:
- Completed.

Done:
- Located the conflicting render path in `HostedPhoneAuthScaffold`.
- Added conflict-code handling for `PRIVY_USER_MISMATCH` and `PRIVY_WALLET_MISMATCH`.
- Switched both manual-continue and SMS-code finalization conflicts to the restart/sign-out recovery state.
- Preserved manual-resume error visibility for real recovery-action failures.
- Added focused regression coverage for manual-resume errors, account conflict, wallet conflict, and SMS-code finalization conflict.

Now:
- Commit and push scoped fix.

Next:
- Monitor the hosted sign-in modal in production after deploy.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-views.tsx`
- `apps/web/test/hosted-phone-auth.test.ts`
- `agent-docs/exec-plans/completed/2026-04-28-hosted-phone-auth-recovery-ux.md`
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
