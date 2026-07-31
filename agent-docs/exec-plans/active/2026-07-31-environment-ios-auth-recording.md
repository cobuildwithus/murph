# Environment iOS auth and recording fix

## Goal

Require an authenticated Murph session before the Environment voice walkthrough
opens, and keep the walkthrough dialog mounted while iOS resolves microphone
permission.

## Constraints

- Preserve the existing recording, upload, privacy, and terminal failure flows.
- Reuse `AuthButton` and the existing dialog dismissal guard.
- Add no new service, persisted state, dependency, or visual component.
- Keep the production change inside the Environment voice capture owner.

## Working set

- `apps/web/app/(dashboard)/environment/environment-voice-capture.tsx`
- `apps/web/src/components/hosted-onboarding/auth-dialog-provider.tsx`
- `apps/web/test/environment-voice-capture.test.tsx`
- `apps/web/test/auth-dialog-provider.test.tsx`
- `apps/web/app/design/environment-progress-study.tsx`

## Verification plan

- Focused Environment voice capture tests, including logged-out entry and a
  pending microphone permission request.
- Changed-file lint and hosted-web typecheck.
- Existing design study readback because the production presentation is
  unchanged and already renders the real capture component.
- Required PR review and exact-head CI.
