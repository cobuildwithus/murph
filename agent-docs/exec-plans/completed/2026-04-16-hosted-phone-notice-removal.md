## Goal (incl. success criteria)

Remove the user-facing country-specific Twilio setup notices from hosted phone auth while preserving the expanded BYO Twilio region list and keeping signup/signin behavior unchanged.

## Constraints / Assumptions

- Scope is limited to hosted phone onboarding UI/tests.
- Do not shrink the supported country list.
- Twilio/Privy setup guidance will be handed off out-of-band to the operator, not rendered in the picker.

## Key decisions

- Remove the country notice helper from the hosted phone flow instead of hiding only selected notices.
- Keep operational setup guidance in handoff, not in product copy.

## State

- in_progress

## Done

- Reviewed the current hosted phone country helper/controller usage.

## Now

- Remove the user-facing notice plumbing and clean up the focused tests.

## Next

- Run focused auth tests and workspace typecheck.
- Commit only the scoped follow-up files plus the closed plan artifact.

## Open questions

- None.

## Working set (files / ids / commands)

- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- `apps/web/src/components/hosted-onboarding/hosted-phone-country-options.ts`
- `apps/web/test/hosted-phone-auth.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-phone-auth.test.ts`
- `pnpm typecheck`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
