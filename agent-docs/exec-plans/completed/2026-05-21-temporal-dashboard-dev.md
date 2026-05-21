# Enable Temporal Web UI For Local Dev

## Goal

Make root `pnpm dev` start managed local Temporal with the built-in Web UI so the
local dashboard is available automatically while the web app and worker use the
same managed Temporal server.

## Scope

- `scripts/dev-hosted-local/temporal.ts`
- `scripts/dev-hosted-local/temporal.test.ts`
- `README.md`
- `packages/hosted-orchestrator-temporal/README.md`

## Constraints

- Preserve the existing managed/external/disabled Temporal modes.
- Preserve `TEMPORAL_DEV_HEADLESS=1` as an explicit local escape hatch.
- Do not touch unrelated dirty Murph Age, MinIO, or hosted-local config work.
- Do not expose local paths, account identifiers, or secrets in docs or output.

## Plan

1. [x] Stop forcing `TEMPORAL_DEV_HEADLESS=1` when `pnpm dev` starts managed Temporal.
2. [x] Update focused tests to prove managed startup no longer disables the Web UI.
3. [x] Document the default dashboard URL and override behavior.
4. [x] Run focused tests plus the required repo-internal verification checks.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/temporal.test.ts --no-coverage`
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/stack.test.ts -t "starts managed Temporal" --no-coverage`
- `bash -n scripts/temporal-dev-server.sh`
- `pnpm typecheck`
- `git diff --check`
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
