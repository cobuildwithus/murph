# Hosted Local-Heartbeat Hardening

## Goal

Remove the unsafe hosted control-plane path where an agent-authenticated local heartbeat can overwrite authoritative connection status or scheduling state, while preserving useful local sync telemetry.

## Scope

- Tighten `POST /api/device-sync/agent/connections/:connectionId/local-heartbeat` request validation.
- Restrict heartbeat updates to validated local sync timestamps and error telemetry.
- Enforce ordering and monotonicity checks before hosted state is updated.
- Add focused route/store coverage for forbidden status/scheduling mutations and malformed or regressive timestamps.

## Constraints

- `status`, disconnect cleanup, signal emission, and reconcile scheduling remain server-owned.
- Do not break the existing browser/public/provider paths for connect, disconnect, or webhook-driven signals.
- Keep the fix scoped to the hosted heartbeat route/lib/test surface unless a small adjacent change is required.

## Verification Plan

- Run focused `apps/web` Vitest coverage for the new heartbeat route/store tests.
- Run `pnpm --dir apps/web typecheck` and, if feasible in the clone, `pnpm --dir apps/web test`.
- Run repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, and record exact blockers if unrelated workspace failures remain.

## Status

Implemented in this clone. The hosted local-heartbeat route now rejects server-owned fields and malformed telemetry, the control-plane/store path only accepts a strict allowlisted heartbeat patch, and heartbeat updates no longer mutate `status`, `nextReconcileAt`, or explicit error-clear state.

## Verification Notes

- `pnpm exec vitest run --configLoader runner --config apps/web/vitest.config.ts apps/web/test/local-heartbeat-route.test.ts apps/web/test/prisma-store-local-heartbeat.test.ts --coverage --maxWorkers 1` passed.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all fail before reaching this slice because the clone is already missing workspace dependencies and `packages/contracts` currently errors on unresolved `zod` imports/type issues.
- `pnpm --dir apps/web typecheck` is also blocked in this clone because `apps/web/node_modules` is absent and `prisma` is unavailable on the app-local PATH.
