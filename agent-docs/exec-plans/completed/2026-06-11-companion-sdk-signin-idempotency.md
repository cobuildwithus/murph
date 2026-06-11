# Companion SDK Sign-In Idempotency

## Goal

Fix PR 132 companion SDK sign-in setup so repeated Junction token requests for
an already-active same-owner connection mint a fresh SDK token without
re-running connection-established side effects or re-enqueueing initial work.

## Scope

- Shared device-sync public ingress SDK sign-in flow.
- Focused tests for repeated token requests and hook-failure behavior.
- Companion route cleanup only if needed to clarify iOS-only metadata.

## Constraints

- Keep the existing shared ingress/control-plane architecture.
- Do not add persistence tables, rate limiters, or provider-specific layers.
- Preserve bearer-only companion route auth and consent/access gates.
- Keep Junction tokens out of logs, persisted artifacts, and test output.

## Verification

- `pnpm typecheck`
- Focused diff or owner coverage for touched `packages/device-syncd` and
  `apps/web` files.
- Direct scenario proof through unit tests for second token mint and hook
  failure after account ensure.
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
