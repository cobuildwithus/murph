# Hosted Execution Seam Split

## Goal

Hard-cut `@murphai/hosted-execution` down to the shared dispatch/transport seam so it no longer publishes the broad Cloudflare control SDK, owner route builders, or duplicated device-sync control-plane contracts.

## Why

- The public hosted package still acts like a mini platform SDK.
- Cloudflare topology has already moved app-local, so the remaining work is ownership cleanup rather than transport inversion.
- A hard cut is acceptable; no compatibility window is required.

## Scope

- Trim `packages/hosted-execution/**` to shared dispatch/auth/runner/outbox/status surfaces.
- Move broad hosted control client ownership into app-local web code.
- Move device-sync hosted runtime request/apply/connect-link seams out of the public hosted package.
- Localize Cloudflare owner routes/callback paths/env readers under `apps/cloudflare/**`.
- Update docs/exports/imports accordingly.

## Constraints

- Preserve unrelated dirty edits in the worktree.
- Re-read overlapping hosted files immediately before editing them.
- Keep status sharing acceptable on the public seam.
- Avoid introducing cross-package cycles or making the public package depend on non-publishable owner packages.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- Targeted proof where the hard cut changes a trust/owner boundary.

## Notes

- This plan restores the active plan path referenced by `COORDINATION_LEDGER.md`.
- Expected follow-up completion path: required `simplify` audit if the implementation diff crosses the size threshold, then required `task-finish-review`, then scoped commit via `scripts/finish-task`.
- Implemented:
  - added private `packages/cloudflare-hosted-control`
  - moved Cloudflare operational control contracts/routes/client out of the public hosted package
  - moved web device-sync runtime callers onto `@murphai/device-syncd/hosted-runtime`
  - localized Cloudflare worker env and outbound route ownership under `apps/cloudflare`
  - removed `packages/hosted-execution/src/web-control-plane.ts`
- Verification status:
  - targeted `apps/web` execution/device-sync/store tests passed under explicit Vitest project selection
  - `pnpm --filter @murphai/hosted-execution test` passed
  - `pnpm --filter @murphai/cloudflare-hosted-control build` passed
  - `pnpm --filter @murphai/hosted-web typecheck` now reaches only pre-existing `packages/core` failures after local hosted seam fixes
  - repo-wide `pnpm typecheck`, `pnpm test:coverage`, `pnpm --filter @murphai/cloudflare-runner typecheck`, and `pnpm --filter @murphai/assistant-runtime typecheck` are blocked by pre-existing failures in `packages/core` and `packages/assistant-engine`
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
