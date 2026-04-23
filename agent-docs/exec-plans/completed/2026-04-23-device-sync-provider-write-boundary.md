# Harden device-sync provider write-boundary enforcement

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Enforce the intended importer-to-core and provider-to-service write boundary inside `packages/device-syncd` so provider code cannot reach raw store or database mutation surfaces through a captured `DeviceSyncService`.
- Keep provider job behavior routed through the existing `ProviderJobContext` seam, replace raw test reach-through with explicit package-local helpers or directly owned store fixtures, and move the one trusted hosted-runtime consumer onto its own store ownership path instead of a public service backdoor.

## Why

- `ProviderJobContext` is intentionally narrow, but `DeviceSyncService.store` is currently public and `SqliteDeviceSyncStore` exposes its raw SQLite handle.
- The current service coverage proves that a same-process provider closure can capture the service and call `service.store.disconnectAccount(...)` during `refreshTokens()`, bypassing the intended canonical mutation path and making the boundary depend on convention instead of mechanical checks.

## Scope

- `packages/device-syncd/src/{service.ts,store.ts,types.ts}`
- `packages/device-syncd/src/{service-controls.ts,service-internals.ts,service-testing.ts}` for package-internal control/testing seams
- directly coupled package-local tests under `packages/device-syncd/test/{service.test.ts,store.test.ts}` plus a narrow helper file if needed
- direct reverse-consumer wiring in `packages/assistant-runtime/src/{device-sync-service.ts,hosted-device-sync-runtime.ts,hosted-runtime/execution.ts,hosted-runtime/maintenance.ts}`
- directly coupled assistant-runtime tests under `packages/assistant-runtime/test/{device-sync-service.test.ts,hosted-device-sync-runtime.test.ts,hosted-runtime-maintenance.test.ts,hosted-runtime-finalize-coverage.test.ts}`
- `agent-docs/exec-plans/active/{2026-04-23-device-sync-provider-write-boundary.md,COORDINATION_LEDGER.md}`

## Out of scope

- provider-specific transport or webhook behavior in `packages/device-syncd/src/providers/**`
- hosted runtime mutation-fence work already active in `packages/device-syncd/src/hosted-runtime.ts`
- broader store schema redesign or new generic SQL escape hatches
- widening the trusted seam beyond the hosted-runtime-owned store association needed by `assistant-runtime`

## Constraints

- Keep the diff additive in the current dirty tree and avoid touching unrelated WHOOP/provider-runtime edits already present under `packages/device-syncd/**`.
- Make the boundary tighter without widening `ProviderJobContext`; providers should keep only the minimal job-time mutations they already need.
- Prefer narrow package-local test helpers over new broad debug or arbitrary SQL surfaces, and do not replace one public `service.store` backdoor with another exported general-purpose store port.
- Follow the repo package-change workflow: plan-bearing lane, coverage-bearing verification, required audits, and a scoped commit only if the shared dirty tree permits it cleanly.

## Risks and mitigations

1. Risk: Hiding the store/database surfaces could force broad test rewrites.
   Mitigation: keep the production change small, inject explicitly owned stores where tests already need setup control, and add only the minimal helper seams needed to inspect persisted outcomes.
2. Risk: Adding broad test-only store helpers could recreate the same leak under a different name.
   Mitigation: keep helpers package-local and behavior-specific, not arbitrary SQL execution or generic internal-object exposure.
3. Risk: Tightening visibility alone could miss another provider-access path.
   Mitigation: search the package for `service.store` / `store.database` use sites and keep provider writes limited to `ProviderJobContext` plus existing service methods.

## Tasks

1. Register the active `device-syncd` boundary-hardening lane and inspect every package use of `service.store` and `store.database`.
2. Make `DeviceSyncService.store` and `SqliteDeviceSyncStore.database` non-public while preserving the current service/provider behavior through `ProviderJobContext`.
3. Replace service-test and store-test reach-through with explicitly owned store fixtures or narrow package-local helpers, including the regression that currently demonstrates provider-side direct store mutation.
4. Move the trusted hosted-runtime consumer to an assistant-runtime-owned store association instead of any public `device-syncd` helper that would recreate the same bypass under a different name.
5. Run truthful `packages/device-syncd` and directly coupled `assistant-runtime` verification, then complete the required `coverage-write` and `task-finish-review` audit passes before commit/handoff.

## Verification

- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/device-syncd test`
- `pnpm --dir packages/device-syncd test:coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/device-sync-service.test.ts test/hosted-device-sync-runtime.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-finalize-coverage.test.ts --no-coverage`
- `git diff --check -- packages/device-syncd/src/service.ts packages/device-syncd/src/service-internals.ts packages/device-syncd/src/service-controls.ts packages/device-syncd/src/service-testing.ts packages/device-syncd/src/http.ts packages/device-syncd/src/index.ts packages/device-syncd/src/store.ts packages/device-syncd/src/types.ts packages/device-syncd/test/service.test.ts packages/device-syncd/test/store.test.ts packages/device-syncd/test/store-test-helpers.ts packages/assistant-runtime/src/device-sync-service.ts packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/src/hosted-runtime/execution.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts packages/assistant-runtime/test/hosted-runtime-finalize-coverage.test.ts`
- Surface proof:
  - `rg -n "service\\.store|service\\.queueManualReconcile|service\\.disconnectAccount|DeviceSyncService\\[\\\"store\\\"\\]" packages/device-syncd packages/assistant-runtime -g '!**/dist/**'` returns no matches
  - provider job execution still supports token refresh and disconnect only through `ProviderJobContext`
  - assistant-runtime owns the trusted store association locally and closes it alongside the device-sync service instead of importing a public store-control helper
Completed: 2026-04-24
