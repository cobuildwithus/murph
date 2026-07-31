# Add Privy phone-link diagnostics

Status: completed
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Make the browser-only Privy phone-link boundary observable in production so a
  failed attempt can be distinguished from a session mismatch, provider exit,
  provider rejection, or Murph sync failure without logging identity data.

## Success criteria

- Phone-link attempts emit a bounded, authenticated sequence of server-visible
  diagnostic events.
- Events contain only allowlisted lifecycle metadata and never phone numbers,
  provider user IDs, tokens, raw errors, or provider payloads.
- Diagnostics do not change linking, retry, session, or sync behavior.
- Focused route and component tests prove the lifecycle and redaction contract.

## Scope

- In scope: the shared Settings/join-invite phone-link component, a narrow
  authenticated diagnostic endpoint, allowlisted event parsing, focused tests,
  and durable observability documentation where required.
- Out of scope: production data repair, Privy dashboard changes, identity
  transfer behavior, and changes to the already-landed phone-link flow.

## Constraints

- Preserve the app-session and fresh-Privy trust boundaries.
- Keep diagnostics metadata-only, best-effort, and non-blocking.
- Use existing hosted-onboarding logging and HTTP helpers.

## Tasks

- [x] Define the minimal diagnostic event contract and authenticated endpoint.
- [x] Emit events at surface, attempt, provider callback, transfer, and Murph
  sync boundaries.
- [x] Add focused privacy and lifecycle regression coverage.
- [x] Run scoped verification and the required specialist and final review
  gates; hand the plan-closing head to exact-head CI.

## Verification

- Passed 68 focused Vitest cases across phone settings, the diagnostic route,
  the diagnostic hook, transport support, and both production callers.
- Passed hosted-web typecheck and targeted ESLint.
- Preliminary specialist findings were accepted and covered. Final ReviewGPT
  round 2 passed with no findings on the remediated implementation head.
- The broad PR matrix passed on the remediated implementation head. The
  plan-closing push must produce the final exact-head CI result.
Completed: 2026-07-31
