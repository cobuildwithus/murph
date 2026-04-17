## Goal

Add a hosted-local E2E regression that reproduces the pre-lease overlapping run-loop race in the Cloudflare user runner and proves the local harness now serializes that path.

## Scope

- `apps/cloudflare/test/hosted-local-duplicate-commit-e2e.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-test-worker-fixture.ts`
- `apps/cloudflare/test/workers/worker-entry.ts`
- `apps/cloudflare/test/workers/runner-e2e-control.ts`

## Constraints

- Keep the new control surface test-only; do not widen production runtime behavior.
- Reproduce the same `transient/dispatch-payloads/*` hydration window that caused the stale lease, not a looser synthetic race.
- Preserve existing duplicate-commit coverage and the broader hosted-local Linq harness.

## Verification

- Focused hosted-local Cloudflare E2E covering overlapping run-loop serialization
- Relevant existing hosted-local Cloudflare E2E regression coverage
- `pnpm --dir apps/cloudflare typecheck`

## Status

- Added test-only control hooks that pause the first `transient/dispatch-payloads/*` read so the hosted-local harness can recreate the exact pre-lease overlap window.
- Added a new hosted-local duplicate-commit E2E that proves the second overlapping alarm no longer starts a competing runner path before the first lease is persisted.
- Added test-only bootstrap coverage for hosted user crypto initialization so synthetic hosted dispatches can exercise the same runtime path as real Linq traffic.
- Tightened the pause control after review so it only enters on the exact staged dispatch-payload object key derived from the target dispatch, preventing false-green matches on unrelated payload reads.

## Verification Results

- `env -u NODE_OPTIONS pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner.test.ts --no-coverage -t "serializes overlapping run loops before a pending dispatch lease is written"`: passed
- `env -u NODE_OPTIONS pnpm --dir apps/cloudflare typecheck`: passed
- `env -u NODE_OPTIONS -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL pnpm --dir apps/cloudflare test:e2e:duplicate-commit:local`: passed
- `env -u NODE_OPTIONS -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`: passed
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
