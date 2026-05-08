# Dashboard replica cleanup follow-up

## Goal

Finish the remaining `WORKSPACE_COMMIT.md` simplification by moving dashboard-replica orchestration out of browser-vault-named internals where it improves clarity, without changing the concrete browser-vault artifact/session protocol.

## Success criteria

- Keep public browser-vault storage/session names for the encrypted artifact format and `/api/browser-vault/session`.
- Use dashboard-replica names for refresh orchestration and source-hash scheduling boundaries.
- Extract the runtime-side refresh algorithm out of `node-runner.ts` into a dedicated dashboard-replica refresher module.
- Keep the web session route thin by moving best-effort refresh scheduling into a small dashboard-replica refresh client.
- Preserve existing behavior and guard tests for pending nudges, active invocation/refresh ordering, stale/missing publish work, metadata-only workspace changes, and too-large refreshes.

## Constraints

- Preserve unrelated working-tree edits.
- Avoid touching active experiment-confounders files.
- Do not rename the concrete `HostedBrowserVaultReplicaRef`, `browserVaultReplicaRef`, browser session route, or encrypted browser-vault store.
- Keep compatibility wrappers where a broad public API rename would create avoidable churn.

## Working set

- `apps/web/src/lib/browser-vault/session-handler.ts`
- `apps/web/src/lib/dashboard-replica/refresh-client.ts`
- `apps/web/test/browser-vault-session-route.test.ts`
- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/dashboard-replica/refresher.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/worker-routes/shared.ts`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/test/node-runner-browser-vault-refresh.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/dashboard-replica/coordinator.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/runner-state-store.bundle-slots.test.ts`

## Verification plan

- Focused hosted execution/browser-vault/dashboard replica tests for touched owners.
- `pnpm typecheck`
- Scoped `test:diff` if it remains truthful; document unrelated failures if reverse-dependent fanout is red outside this diff.

## Status

- Extracted Cloudflare dashboard-replica refresh generation from `node-runner.ts`.
- Added a runner-side dashboard-replica coordinator for pending refresh scheduling, continuation alarms, and foreground-work preemption.
- Added dashboard-replica state-store method names over the existing browser-vault pending refresh storage key.
- Added a web dashboard-replica refresh client and kept browser-vault session compatibility.
- Focused Cloudflare/web tests passed; `pnpm typecheck` passed.
- `test:diff` still fails in CLI document/meal reverse-dependent tests outside this working set.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
