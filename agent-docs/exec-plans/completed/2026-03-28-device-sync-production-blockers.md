# 2026-03-28 Device-Sync Production Blockers

## Goal

Resolve the remaining hosted device-sync production blockers from the final review so hosted control-plane state, local mirrored runtime state, and Cloudflare wake scheduling stay in parity.

## Scope

- Add a dedicated hosted device-sync wake source so future `nextReconcileAt` work is not lost behind assistant-only wakes.
- Finish hosted token fencing so stale runners cannot mutate expiry metadata or churn token versions on null-expiry no-op updates.
- Replace the ad hoc hosted hydration flow with one store-owned hosted hydrate/disconnect path that:
  - replaces metadata instead of merging it
  - hydrates or clears error fields explicitly
  - applies monotonic timestamp reconciliation
  - clears mirrored local tokens on hosted disconnect
- Add focused regression coverage across the hosted web apply path, hosted assistant-runtime hydration/reconciliation logic, device-sync store primitives, and Cloudflare/maintenance wake scheduling.

## Constraints

- Preserve the current hosted control-plane trust boundary and the existing `device-sync.wake` event path.
- Work on top of the already-dirty tree without reverting unrelated edits in `apps/web/next-env.d.ts` or `packages/hosted-execution/test/hosted-execution.test.ts`.
- Keep the follow-up scoped to the reviewed device-sync/runtime/runner seams; do not widen into unrelated assistant or onboarding changes.

## Planned Shape

1. Extend hosted maintenance output to report the earliest device-sync wake alongside assistant cron, and feed that into the Cloudflare runner scheduler.
2. Fix hosted apply ordering so token-version mismatches fence all token-derived mutations, including expiry metadata, and normalize null-expiry comparison.
3. Introduce a dedicated hosted-hydration store primitive in `packages/device-syncd` and rewire hosted sync/disconnect paths to use it.
4. Make hosted reconciliation emit only safe forward-moving timestamp/error updates and avoid stale local state pushing hosted rows backward.
5. Add focused regression tests for each blocker before running repo verification and audit passes.

## Verification Plan

- Run focused Vitest coverage for the touched device-sync, assistant-runtime, hosted web, and Cloudflare tests.
- Run repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Record direct scenario evidence for the hosted wake scheduling path and the hosted hydration/reconciliation regressions through focused tests if no broader manual runtime is needed.

## Outcome

- Hosted maintenance now reports the earliest assistant/device-sync wake using a dedicated device-sync wake source and computes due-now wake timing from maintenance completion time.
- Hosted runtime apply now fences all token-derived expiry mutations on token-version mismatch, including expiry-only updates, and null-expiry no-op updates no longer churn token versions.
- Hosted hydration now uses a store-owned primitive that replaces metadata, clears mirrored local tokens and stale errors on disconnect, preserves monotonic observed hosted markers, and avoids treating hosted hydrate receipt time as a local mutation.
- Hosted reconciliation now preserves forward-only timestamp updates, clears disconnected stale hosted errors correctly, and only lets hosted `nextReconcileAt` win when the hosted snapshot has actually advanced.

## Verification Results

- Passed focused tests:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1 apps/web/test/device-sync-internal-runtime.test.ts`
  - `pnpm exec vitest run --no-coverage --maxWorkers 1 packages/device-syncd/test/service.test.ts`
  - `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage --maxWorkers 1 packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/user-runner.test.ts`
- Passed focused typechecks:
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
- Repo-wide verification remains blocked outside this lane:
  - `pnpm typecheck` fails in `scripts/verify.ts` (`@murph/contracts` resolution plus implicit-`any` errors).
  - `pnpm test` fails during `packages/web` Turbopack build because sibling workspace package source entrypoints resolve to missing `.js` files under `packages/{contracts,query,runtime-state}/src`.
  - `pnpm test:coverage` fails for the same `packages/web` Turbopack build/module-resolution issue.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
