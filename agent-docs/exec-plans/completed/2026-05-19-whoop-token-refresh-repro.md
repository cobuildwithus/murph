# Diagnose WHOOP hosted token refresh recovery

Status: completed
Created: 2026-05-19
Updated: 2026-05-19

## Goal

- Diagnose and reproduce why a WHOOP refresh-token failure can leave the hosted connection `active` with stale data instead of moving to an explicit reconnect/reauthorization state.

## Success criteria

- A focused test reproduces the refresh-token failure shape that matches the production symptom.
- If the repro proves a bug, the fix is scoped to the owner path and preserves provider-token privacy.
- The connection status semantics are clear: unrecoverable user-token failures require reauthorization; transient/provider failures stay retryable or attention-worthy without overclassifying secrets/config problems.
- Targeted tests and typecheck/diff verification pass, or any unrelated blockers are named precisely.

## Scope

- In scope:
  - WHOOP OAuth refresh-token error classification in `packages/device-syncd`.
  - Hosted token-refresh/status propagation tests where needed to prove user-visible behavior.
- Out of scope:
  - Live WHOOP API calls.
  - Manual reconnecting or modifying production user data.
  - Broad device-sync scheduling or dirty-state changes.

## Constraints

- Technical constraints:
  - Do not log, fixture, or persist raw provider token response bodies or credentials.
  - Keep refresh-token classification provider-owned and reusable through existing device-sync error/status propagation.
- Product/process constraints:
  - Keep the result simple and maintainable; no new locking, state tables, or broad status framework.
  - Preserve unrelated dirty working-tree edits.

## Risks and mitigations

1. Risk: Overclassifying transient token endpoint failures as reconnect-required.
   Mitigation: Classify only refresh-token grant failures that indicate user-token invalidation/authorization loss.
2. Risk: Leaking provider error body details while diagnosing.
   Mitigation: Parse only safe OAuth error codes for branching and keep persisted messages sanitized.

## Tasks

1. Trace WHOOP refresh-token flow across provider, local service, hosted runtime, and web status projection.
2. Add a focused repro for refresh-token invalidation returning a token endpoint failure.
3. Patch the smallest provider-owned classifier if the repro fails for the current bug.
4. Run targeted verification and required completion audits.

## Decisions

- Treat the current production symptom as unresolved until the refresh-token failure either becomes reconnect-required or is proven transient/provider-side.
- A WHOOP refresh-token token endpoint response with OAuth `error: invalid_grant` is an unrecoverable user authorization loss and should set `reauthorization_required`; other refresh-token token endpoint failures remain generic unless classified more specifically.
- A WHOOP token endpoint `429` is retryable; explicit OAuth `invalid_client` is an app/client configuration failure, not a user reauthorization signal.

## Verification

- Commands to run:
  - `pnpm --dir packages/device-syncd test -- whoop-provider.test.ts` (passed after fix; failed before fix with `accountStatus: null`)
  - `pnpm test:diff <touched paths>`
  - `pnpm typecheck`
- Expected outcomes:
  - The WHOOP refresh-token invalidation repro passes after the fix.
  - No raw token values or provider bodies appear in diffs or logs.
Completed: 2026-05-19
