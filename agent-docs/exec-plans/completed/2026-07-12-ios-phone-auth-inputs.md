# iOS Phone Auth Inputs

## Goal

Make hosted phone authentication behave naturally on iOS: seed the country prefix from the request country, let saved-phone autofill populate the field, split an entered international prefix into the country control, and focus the verification-code input as soon as it becomes interactive.

## Constraints

- Preserve the existing Privy send-code and verification authority boundaries.
- Keep phone numbers client-only in this UI path and do not add logging or persistence.
- Reuse the existing country option list and phone normalization owner; add no dependency or alternate phone-number source of truth.
- Preserve non-iOS keyboard, autofill, resend, and auto-submit behavior.
- Keep the change scoped to hosted phone-auth inputs and focused tests.

## Root-cause evidence

- The phone control currently renders a text input with `inputMode="tel"` and `autoComplete="tel-national"`, which does not provide iOS the full semantic `type="tel"` / `autocomplete="tel"` signal for a saved international number.
- The controlled phone value accepts an international number verbatim and never projects its dial prefix into the separate country picker.
- The verification input can mount while the send-code action still marks the flow disabled. Browser `autoFocus` is ignored on that disabled mount and was not retried when the action cleared.

## Plan

1. Add a small, deterministic international-prefix splitter at the shared phone input boundary and use it to update the country picker plus national-number value together.
2. Give the phone field the canonical tel input/autocomplete semantics needed for iOS saved-number autofill.
3. Refocus the OTP input when it transitions from disabled to enabled, without changing completion blur or auto-submit behavior.
4. Add focused regressions for international-number splitting, tel semantics, locale seeding, and delayed OTP focus.
5. Run the routed auth/privacy, frontend, coverage, browser, and scoped verification workflow; then close the plan with a scoped commit.

## Verification

- Focused hosted phone-auth Vitest: 62 tests passed.
- `pnpm test:diff` passed 4,267 assertions, lint, and TypeScript. The subsequent Next static-generation step timed out on the unchanged site-wide `/opengraph-image` route.
- Required security/privacy and frontend reviews found no actionable issues.
- Mobile and desktop browser inspection was unavailable because the supported in-app browser had no active browser backend; real iOS keyboard presentation remains a device-verification gap.
- Coverage-write audit added component-boundary proof for the real phone-input callbacks and found no remaining executable coverage gap.

## State

Implementation, scoped verification, and required audits complete. Final commit pending.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
