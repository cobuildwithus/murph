# Hosted Internal Auth And Bootstrap Hardening

## Goal

Close the remaining Cloudflare trust-boundary gaps by binding the hosted-web callback MAC to the target user id and query string, adding durable replay suppression for those signed requests, and preventing top-level worker paths from racing first-touch user root-key bootstrap outside the per-user Durable Object lane.

## Why this plan exists

- The current HMAC callback seam still signs only method, path, payload, and timestamp.
- The bound `x-hosted-execution-user-id` header currently sits outside the MAC, so a valid signed request is not cryptographically tied to the target user.
- The current verifier allows timestamp skew but does not consume a nonce or request id, so the same signed request can be replayed within the skew window.
- The current user-root-key store still auto-bootstraps a missing envelope on plain read-miss, and top-level worker paths can reach that code outside the per-user single-writer lane.
- The current platform-envelope key decoder accepts syntactically valid base64 regardless of decoded key length.

## Constraints

- Keep scope to the Cloudflare trust-boundary fixes in the current launch path; do not redesign the OIDC control edge or bearer-token scheduler/share routes here.
- Preserve unrelated dirty-tree edits.
- Prefer one shared canonical request shape in `packages/hosted-execution` rather than route-local patches.
- Add focused tests for request binding, replay suppression, first-touch bootstrap behavior, and fixed-length platform-envelope parsing.

## Plan

1. Inspect the current shared HMAC helper, Cloudflare request builder, hosted-web verifier, and the affected route/tests.
2. Extend the shared signing primitive to cover the bound user id, query string, and a per-request nonce.
3. Add durable replay suppression on the hosted-web verifier path and update the internal route to use the bound verified user id.
4. Split user-root-key access into DO-only bootstrap versus require-existing reads, then hand top-level worker paths back through the per-user runner lane before reading user-root-key-backed state.
5. Enforce fixed 32-byte platform-envelope key parsing at env load, run focused verification, then commit with the repo helper.

## Current state

- Shared callback signing, replay suppression, and bound-user verification are implemented on the hosted-web internal seam in the current worktree.
- Cloudflare top-level worker ingress and runner-outbound paths now hand first-touch user bootstrap back through the bound per-user Durable Object before they read user-root-key-backed storage.
- Platform-envelope key parsing now rejects any base64/base64url value that does not decode to exactly 32 bytes.
- Focused verification is green across `packages/hosted-execution`, `apps/web`, and the touched Cloudflare suites.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
