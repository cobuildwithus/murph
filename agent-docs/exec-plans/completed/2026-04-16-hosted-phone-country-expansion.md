## Goal

Replace the hosted phone auth country picker's `US`/`CA` hardcode with a broad international option set that matches the Privy BYO Twilio posture.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- `apps/web/src/components/hosted-onboarding/hosted-phone-country-options.ts`
- focused `apps/web/test/**` coverage for hosted phone auth country metadata and picker defaults

## Constraints

- Keep the existing signup, signin, and link flows unchanged apart from available country options.
- Preserve the current default selection (`US`) and existing national-number normalization behavior.
- Avoid unrelated hosted onboarding session, routing, or server-side auth changes.

## Verification

- Focused hosted-web tests covering the expanded country option source and picker defaults
- App-level verification for the touched `apps/web` slice per repo policy
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
