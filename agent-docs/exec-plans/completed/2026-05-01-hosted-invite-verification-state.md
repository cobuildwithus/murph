Goal (incl. success criteria):
- Split hosted invite verification from post-auth messaging setup so phone-bound join links cannot offer Telegram as an alternate verification path.
- Success means the invite status payload carries an explicit verification mode, the verify-stage UI renders a phone-verification component, and the Telegram/phone picker remains only for authenticated messaging setup.
- Also keep the shared card/picker pieces composable enough that verification and messaging setup do not re-entangle.

Constraints/Assumptions:
- Preserve unrelated dirty hosted onboarding layout edits and the existing active invite-layout row.
- Do not print or fixture real invite codes, phone numbers, Telegram ids, provider payloads, secrets, or local paths.
- Keep existing `stage: "verify"` semantics compatible while adding a more specific state field for UI dispatch.

Key decisions:
- Use an explicit invite verification mode rather than inferring UI behavior only from `phoneAuthTarget`.
- Keep messaging-channel selection in the authenticated checkout/messaging-setup path.
- Keep the contact-method picker as a messaging-setup component, with responsive cards and semantic selected state.

State:
- Completed; ready for scoped finish.

Done:
- Diagnosed the current bug: `JoinInviteVerificationPanel` always renders the contact-method picker even for saved phone invite targets.
- Added `invite.verificationMode` so the join UI can distinguish invite-bound phone verification from manual phone entry.
- Split verify-stage rendering into `JoinInvitePhoneVerificationPanel`; kept `JoinInviteMessagingSetupPanel` as the only owner of the phone/Telegram picker.
- Refactored the shared panel/picker pieces so verification and messaging setup stay compositionally separate.
- Added focused coverage for invite-phone verify, manual-phone verify, session-settling verify, messaging setup picker, and status-mode derivation.
- Verification passed: focused Vitest, hosted-web typecheck, and diff-scoped `test:diff`/`apps/web verify`.
- Required security/privacy, frontend, coverage-write, and task-finish review passes completed with no remaining code blockers.

Now:
- Closing the active plan and creating a scoped commit if the dirty checkout allows it safely.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/types.ts`
- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/src/components/hosted-onboarding/join-invite-state.ts`
- `apps/web/src/components/hosted-onboarding/join-invite-sections.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-stage-panels.tsx`
- `apps/web/src/components/hosted-onboarding/join-invite-preview.ts`
- `apps/web/test/join-invite-client.test.ts`
- `apps/web/test/hosted-onboarding-privy-invite-status.test.ts`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
