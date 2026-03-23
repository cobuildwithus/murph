# Hosted Device Sync Control Plane in `apps/web`

## Goal

Add a Vercel-ready hosted device-sync control-plane app under `apps/web` that reuses the shared ingress/core logic, persists durable state in Postgres via Prisma, and exposes the browser/public/local-agent routes needed for hosted WHOOP and Oura integration.

## Scope

- Create a new Next.js app at `apps/web` rather than mutating the existing local-only `packages/web` surface.
- Add Prisma/Postgres wiring, schema, and migration files for hosted device-sync state only.
- Reuse `@healthybob/device-syncd` provider/public-ingress logic in the hosted app.
- Implement authenticated browser routes for connection metadata, connect/disconnect, and agent pairing.
- Implement public OAuth callback/webhook routes plus local-agent token/signal routes.
- Add focused tests/docs/scripts/workspace wiring for the new app.

## Constraints

- Keep canonical health data out of the hosted app; only integration/auth/control state may persist in Postgres.
- Do not expose raw provider tokens to browsers.
- Keep callback/webhook logic shared with local/tunnel mode; do not fork provider-specific ingress behavior.
- Preserve the existing local-only `packages/web` app and current repo behavior outside the new hosted lane.

## Verification Plan

- Run focused syntax/tests for the new `apps/web` device-sync route/lib surface where dependencies allow.
- Run the completion-workflow audit passes for the code change.
- Record any broader workspace failures that are pre-existing or dependency-blocked.

## Status

Implemented in this branch. The hosted control plane now has a dedicated `apps/web` Next.js app, Prisma/Postgres schema + migration, shared-ingress reuse from `@healthybob/device-syncd`, browser/public/agent route handlers, and focused auth/crypto tests.

## Verification Notes

- `pnpm --dir apps/web typecheck` passed after installing the workspace dependencies and generating the Prisma client.
- `pnpm --dir apps/web test` passed, including the hosted app vitest suite and `next build --webpack`.
- `pnpm typecheck` passed at the repo root.
- `pnpm test` currently fails outside this lane in `packages/web` because `packages/query` expects several `@healthybob/contracts` exports that are not present in the current worktree build.
- `pnpm test:coverage` currently fails outside this lane because the smoke harness is missing documented supplement command scenarios.
