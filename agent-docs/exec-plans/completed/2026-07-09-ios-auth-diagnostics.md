# iOS Auth Diagnostics

## Goal

Capture sanitized companion-app Privy auth failures durably enough to debug App Review login failures, and keep the iOS client from collapsing every OTP error into one generic message.

## Scope

- Add a public companion auth diagnostics route that accepts bounded, redacted metadata only.
- Add focused route tests for accepted diagnostics, redaction, and malformed input.
- Keep the provider message after client- and server-side sanitization so hosted warnings remain actionable.
- Keep OTP retry user-directed through the existing Send code and Resend actions; do not replay a non-idempotent provider send automatically.
- Require a Vercel WAF fixed-window limit on the public diagnostics path; keep the in-process counter as bounded defense in depth only.
- Do not persist email, phone, OTP code, tokens, authorization headers, member IDs, user IDs, or health data.

## Verification

- Run the focused web route tests.
- Run web typecheck after the focused tests.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
