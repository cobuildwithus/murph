# WHOOP Token Request Diagnostics

## Goal

Add safe diagnostics for WHOOP OAuth token-refresh failures so production logs show the request shape and included parameter names without exposing tokens, client secrets, auth headers, raw bodies, or provider payloads.

Success criteria:

- WHOOP token request failures include metadata-only request diagnostics in device-sync, hosted runtime, assistant-runtime maintenance, and web runtime logs.
- Diagnostics show parameter names and safe scalar facts needed to debug malformed-parameter failures.
- Tests prove the fields propagate through the existing diagnostic pipeline.

## Constraints / Assumptions

- Do not log access tokens, refresh tokens, client secrets, raw authorization headers, raw request bodies, raw provider responses, user identifiers, or local machine identifiers.
- Keep the existing durable SQL policy that omits provider-sourced free-form error text from `device_connection.last_error_message`.
- Prefer the existing provider failure diagnostic pipeline over a new logging subsystem.
- Preserve unrelated dirty worktree edits and active ledger rows.

## Working Set

- `packages/device-syncd/src/providers/whoop.ts`
- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- focused tests covering those propagation seams

## Plan

1. Inspect the current WHOOP token-request builder and diagnostic allowlists.
2. Add metadata-only request-shape diagnostics at the provider boundary.
3. Thread the new fields through the existing hosted diagnostic allowlists.
4. Update focused tests and run scoped verification.
5. Run required security/privacy, coverage, and final-review passes before closing the plan.

## State

- Status: active
- Current step: review and closeout
- Implementation: added provider request-shape diagnostics and threaded them through existing hosted log allowlists.
- Verification: focused tests, package/app typechecks, package coverage, and hosted-web lint passed; scoped repo diff verifier is blocked by unrelated raw-payload log guard findings in hosted onboarding workflow files.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
