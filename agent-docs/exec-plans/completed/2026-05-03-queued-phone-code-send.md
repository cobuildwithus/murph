Goal:
- Fix hosted phone verification so clicking "Send verification code" before Privy is ready records a recoverable user intent and sends once Privy becomes ready.
- Success means manual phone entry, phone linking, and saved invite phone shortcuts share the same simple behavior: click accepted, no visible loading while only waiting for Privy readiness, real sending state only during the actual send, and users can retry by clicking again after any weird or failed state.

Constraints:
- Preserve unrelated dirty work and active ledger rows.
- Do not call the invite send-code server route until Privy is ready to actually send through the SDK.
- Do not add a visible waiting-for-Privy loading state or expand `HostedPhoneAuthPendingAction` for readiness waiting.
- Keep code/test changes scoped to hosted onboarding phone auth.

Key decisions:
- Use an invisible queued-send intent separate from `pendingAction`.
- Use existing `pendingAction = "send-code"` only for real network work.
- Keep manual phone entry recovery user-driven by leaving the button clickable before Privy readiness.

State:
- complete

Done:
- Reviewed hosted phone auth controller, invite shortcut, and code-entry surfaces.
- Implemented queued send-code intent for manual hosted phone auth and saved invite phone shortcuts.
- Bound saved-invite queued sends to the invite/hint visible at click time and clear stale queues on authenticated resume or invite-target changes.
- Added focused tests for manual and saved-invite clicks before Privy readiness, repeated-click coalescing, readiness drain, authenticated resume clearing, link-phone authenticated drain, and invite-target stale queue clearing.
- Completed security/privacy, frontend, coverage, final completion, and simplify audits; addressed security and coverage findings.
- Verified focused hosted phone auth tests, scoped apps/web diff verification, and root typecheck.

Now:
- Ready to archive and commit.

Next:
- None.

Open questions:
- None.

Working set:
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- `apps/web/src/components/hosted-onboarding/hosted-invite-phone-auth.tsx`
- `apps/web/test/hosted-phone-auth.test.ts`
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
