# Timestamp Instant Ordering

## Goal

Fix timestamp-ordering bugs where valid offset-bearing timestamps can be ordered
by string shape instead of by the represented instant.

Success criteria:

- Hosted outbox delivery candidate ordering compares `createdAt` instants.
- Assistant, hosted-runtime, gateway, event lifecycle, and core history
  timestamp ordering compare instants where the fields represent instants.
- Mixed-offset timestamp regressions cover the affected surfaces.
- Verification passes, then a scoped commit is pushed.

## Constraints

- Keep the fix simple and local to existing runtime/gateway seams.
- Do not add persisted state, schedulers, compatibility layers, or broad
  abstractions.
- Preserve existing tie-breakers for deterministic ordering.
- Keep hosted product/control ownership unchanged: web owns product facts,
  Cloudflare/gateway caches stay derived.

## State

Started 2026-06-24.

## Done

- Confirmed the checkout is on `main` and even with `origin/main`.
- Identified affected comparisons in hosted-runtime callbacks and gateway
  projection/snapshot code.
- Expanded the fix to assistant-engine ordering helpers, hosted workspace
  restore receipt replay, contracts event lifecycle ordering, and core
  history/assessment ordering after the repo-wide timestamp sweep found more
  instant fields.
- Added focused mixed-offset timestamp regressions across affected surfaces.
- Updated a stale operator-config test expectation to match the current default
  Codex reasoning effort.
- Ran focused tests, expanded `test:diff`, root `pnpm typecheck`, `git diff
  --check`, and a final timestamp string-order sweep.

## Now

- Commit and push the scoped change.

## Next

- Close this plan with `scripts/finish-task`.

## Open Questions

- None.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/src/hosted-runtime/timestamp-order.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-engine/test/assistant-*.test.ts`
- `packages/contracts/src/time.ts`
- `packages/contracts/src/event-lifecycle.ts`
- `packages/contracts/test/*`
- `packages/core/src/time.ts`
- `packages/core/src/history/shared.ts`
- `packages/core/src/assessment/storage.ts`
- `packages/core/test/core-utilities.test.ts`
- `packages/gateway-core/src/snapshot.ts`
- `packages/gateway-core/test/*`
- `apps/cloudflare/src/gateway-projection-cache.ts`
- `apps/cloudflare/src/gateway-projection-cache-permissions.ts`
- `apps/cloudflare/test/gateway-projection-cache.test.ts`
- `packages/operator-config/test/config-env.test.ts`
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
