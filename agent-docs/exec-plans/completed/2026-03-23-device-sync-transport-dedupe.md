# 2026-03-23 Device Sync Transport Dedupe

## Goal

Extract the duplicated low-level device-sync transport helpers and shared type
shapes out of the CLI and web wrappers so future auth/request/error fixes land
once, while preserving both surfaces' current behavior.

## Scope

- add one shared pure helper module in `packages/runtime-state`
- move shared device-sync URL/auth/JSON/error-envelope helpers and common
  provider/account record types there
- keep CLI and web wrapper-specific error classes/messages/signatures in place
- update focused tests only where needed to lock behavior

## Non-Goals

- no daemon route/config changes
- no user-facing CLI/web behavior changes beyond internal dedupe
- no broader device-sync API redesign

## Invariants

- CLI keeps `VaultCliError` codes/messages/details behavior
- web keeps `DeviceSyncWebError` behavior and overview messaging
- auth header injection and default localhost resolution stay unchanged
- empty/invalid JSON handling stays unchanged

## Outcome

- Added `packages/runtime-state/src/device-sync.ts` with the shared
  URL-resolution, auth-header, JSON/error-envelope, and request-pipeline logic.
- Moved the shared provider/account record shapes into `runtime-state`.
- Rebuilt the CLI and web wrappers on top of the shared request primitive while
  preserving their surface-specific error shaping and public signatures.

## Verification

- `pnpm --dir packages/runtime-state build` ✅
- `pnpm --dir packages/web typecheck` ✅
- `pnpm exec vitest run packages/cli/test/device-sync-client.test.ts --no-coverage --maxWorkers 1` ✅
- `pnpm exec vitest run --config packages/web/vitest.config.ts packages/web/test/device-sync-lib.test.ts packages/web/test/device-sync-routes.test.ts packages/web/test/page.test.ts --no-coverage --maxWorkers 1` ✅
- `pnpm typecheck` ❌ unrelated pre-existing failures in `packages/query/src/{health/shared,markdown}.ts`
- `pnpm test` ❌ unrelated pre-existing failure in `packages/cli/src/assistant-cli-tools.ts`
- `pnpm test:coverage` ❌ blocked by the same unrelated `packages/cli/src/assistant-cli-tools.ts` failure

Status: completed
Updated: 2026-03-23
Completed: 2026-03-23
