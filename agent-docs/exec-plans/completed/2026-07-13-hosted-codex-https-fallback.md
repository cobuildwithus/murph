# Hosted Codex HTTPS fallback reachability

## Goal

Make Codex's native WebSocket-to-HTTPS fallback reachable within one hosted
assistant attempt when the provider stream stalls or disconnects retryably.

Success criteria:

- Hosted Codex config permits one WebSocket attempt and then native HTTPS
  fallback.
- The existing 90-second stream idle timeout and HTTP request retry budget stay
  unchanged.
- Focused tests protect the generated config and safe transport diagnostics.
- Required reliability, security/privacy, and coverage checks pass.

## Root-cause evidence

- The affected hosted attempts opened WebSockets but emitted neither an HTTPS
  request nor the existing structured `transport-fallback` diagnostic.
- Codex exhausts `stream_max_retries` before switching transport. The hosted
  value of five made fallback unreachable inside the enclosing hosted attempt
  budget, and each new orchestration attempt reset Codex's turn-local counter.
- Runtime resource telemetry showed no matching CPU, memory, OOM, eviction, or
  process-limit failure.
- The currently pinned Codex release already implements native HTTPS fallback;
  later patch releases do not change that mechanism.

## Constraints

- Keep the change hosted-only; do not alter Codex CLI source or global defaults.
- Reuse Codex's native fallback and retry machinery without adding another
  retry loop or state owner.
- Preserve secret-safe structured transport diagnostics.
- Preserve unrelated worktree and coordination-ledger edits.

## Approach

1. Set hosted provider stream retries to zero while keeping WebSockets enabled.
2. Update focused config and diagnostics expectations for the one-attempt policy.
3. Document the hosted transport policy at the package owner boundary.
4. Run focused tests, typecheck, and direct generated-config proof.
5. Run required security/privacy and coverage audits.
6. Commit the scoped change, open a PR, and complete CI plus ReviewGPT gates.

## State

Active.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
