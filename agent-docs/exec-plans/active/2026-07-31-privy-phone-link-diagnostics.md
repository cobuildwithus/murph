# Add Privy phone-link diagnostics

Status: active
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

1. Define the minimal diagnostic event contract and authenticated endpoint.
2. Emit events at attempt, provider callback, and Murph sync boundaries.
3. Add focused privacy and lifecycle regression coverage.
4. Run scoped verification, required review gates, CI, and close the plan.

## Verification

- Focused Vitest coverage for the phone settings component and diagnostic route.
- Hosted web typecheck and any diff-selected required checks.
- Exact-head ReviewGPT and CI through the normal PR lane.
