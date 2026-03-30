# Device Syncd Control Plane Lockdown

## Goal

Make `device-syncd` behave like a local-only authenticated control plane while keeping provider webhook intake available only when explicitly configured.

## Scope

- Default the control-plane listener to `127.0.0.1`.
- Add explicit control-plane request guards for loopback-only access plus HTTP authorization on control routes.
- Keep OAuth callback/webhook handling compatible with provider flows without leaving account/control routes unauthenticated.
- Thread the new auth contract through CLI/web clients and update docs/architecture/runtime assumptions.
- Add focused tests that reject non-loopback or unauthenticated control-plane requests and still accept valid webhook delivery.

## Constraints

- Preserve the in-progress localhost-default host and per-account job-serialization edits already present in the worktree.
- Do not read `.env*` files or expose secrets in code, logs, docs, or test fixtures.
- Avoid widening the public surface; any webhook exposure must be opt-in and clearly separated from local control routes.

## Verification Plan

- Run completion workflow audit passes after functional changes land.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
