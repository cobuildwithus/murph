# Cloudflare Outbound Worker Handlers

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Replace the hosted runner's container -> public worker callback flow with direct internal outbound Worker handlers, while preserving the durable commit/finalize journal semantics and hosted assistant outbox reconciliation behavior.

## Scope

- Install an internal outbound Worker bridge for the native container before hosted execution runs.
- Rewire the node runner to call internal `http://*.worker` hostnames for commit/finalize/outbox journal work instead of public callback URLs.
- Remove `HOSTED_EXECUTION_CLOUDFLARE_BASE_URL` and the public worker callback routes that only existed for runner callbacks.
- Update focused Cloudflare tests plus the truthful docs/config surfaces that describe the runtime/deploy contract.

## Constraints

- Keep the signed `apps/web` -> `apps/cloudflare` ingress unchanged.
- Preserve Durable Object commit/finalize locking and the post-commit hosted assistant outbox flow.
- Keep the change narrow: callback transport only, not a broader re-architecture of queue storage or public control routes.
- Build on top of the current dirty `apps/cloudflare/src/index.ts` route-table work without overwriting unrelated changes.
- Treat the new outbound bridge as same-machine internal routing, not a public API surface.

## Planned changes

1. Add a loopback outbound Worker handler export and install it on the native container with the low-level outbound interception API.
2. Replace public callback URL construction in `HostedUserRunner` with internal runner callback metadata only.
3. Update `node-runner.ts` to call internal `commit.worker` / `outbox.worker` hostnames.
4. Delete the public worker callback routes and the now-unused callback base-url env/deploy wiring.
5. Update tests and docs to reflect the internal transport.

## Outcome

- Added the direct outbound handler bridge in `RunnerContainer` and a shared `runner-outbound.ts` handler that commits/finalizes durable state and reads/writes the hosted side-effect journal without re-entering the public worker surface.
- Removed the public runner callback routes and runner bearer-auth path from the Cloudflare worker entrypoint.
- Added focused unit and Workers-runtime coverage for the new container bridge and direct `commit.worker` / `outbox.worker` flow.
- Carried the shared hosted-execution contract/env helpers as a dedicated workspace package so the Cloudflare lane can consume one canonical hosted transport surface.
- Added the shared smoke-helper module and its regression test so `deploy:smoke` remains runnable from a clean checkout, without depending on the removed public callback base URL.

## Verification results

- `pnpm --dir apps/cloudflare test`
  - passed
- `pnpm --dir apps/cloudflare test:workers`
  - passed, with the existing non-fatal Vitest/workerd teardown noise after completion
- `pnpm typecheck`
  - passed
- `pnpm test`
  - failed outside this lane in `packages/cli/test/{assistant-state,canonical-write-lock,runtime,search-runtime}.test.ts`
- `pnpm test:coverage`
  - failed outside this lane in `packages/cli/test/{canonical-write-lock,runtime,search-runtime}.test.ts`, then aborted with an unrelated Vitest coverage inspector disconnect (`ERR_INSPECTOR_NOT_CONNECTED`)

## Audit pass status

- `simplify`
  - no actionable Cloudflare outbound-handler issues found
- `test-coverage-audit`
  - no actionable coverage gaps found
- `task-finish-review`
  - found one smoke-script packaging issue around `smoke-hosted-deploy.shared.ts`; fixed in this lane and followed by a green focused Cloudflare rerun
