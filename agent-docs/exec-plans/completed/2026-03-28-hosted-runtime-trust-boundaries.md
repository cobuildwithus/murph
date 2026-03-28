# Hosted runtime trust-boundary cleanup

## Goal

Implement the requested behavior-preserving hosted-runtime simplifications by:
- moving hosted web-control-plane HTTP adapters out of `packages/assistant-runtime`
- centralizing hosted dispatch/outbox lifecycle mapping in `packages/hosted-execution`
- preferring immutable outbox payload snapshots where practical while keeping explicit by-reference storage for large/sensitive events
- separating hosted control/internal/share/scheduler/container tokens instead of silent fallback chains

## Scope

- `packages/hosted-execution/**`
- `packages/assistant-runtime/**`
- `apps/web/src/lib/hosted-execution/**`
- hosted web internal auth helpers and matching tests
- `apps/cloudflare/src/{node-runner,runner-env,user-runner}.ts` and matching tests

## Out of Scope

- changing the durable hosted runner queue model
- changing webhook/onboarding product behavior
- new auth products or deploy-time secret names beyond the requested token split

## Risks

1. Legacy outbox rows could become unreadable.
   Mitigation: keep legacy ref parsing and source-backed hydration compatibility.
2. Shared lifecycle helpers could drift from current queue/outbox behavior.
   Mitigation: move the exact existing mappings into `packages/hosted-execution` and add parity tests.
3. Stricter token requirements could break implicit local/test paths.
   Mitigation: update focused tests and keep failures explicit and closed rather than silent.

## Plan

1. Add shared hosted-execution helpers for outbox payload ownership, dispatch-state/lifecycle mapping, and hosted web-control-plane requests.
2. Rewire assistant-runtime and Cloudflare to use those shared helpers instead of package-local hosted URL/token logic.
3. Rewire apps/web outbox/auth flows to the shared payload/lifecycle helpers and stricter token separation.
4. Update focused tests, then run required verification commands.

## Verification

- Focused tests passed:
  - `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-http.test.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts --config packages/assistant-runtime/vitest.config.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-execution-hydration.test.ts apps/web/test/hosted-execution-outbox.test.ts apps/web/test/hosted-execution-routes.test.ts --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/runner-env.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1`
- Focused package typechecks passed:
  - `pnpm exec tsc -p packages/hosted-execution/tsconfig.json --noEmit --pretty false`
- Repo-required verification still fails for unrelated active-tree reasons:
  - `pnpm typecheck` fails in `packages/cli/src/{assistant/service.ts,commands/assistant.ts}`
  - `pnpm test` fails on blocked handwritten coverage artifacts under `packages/cli/coverage/lcov-report/*.js`
  - `pnpm test:coverage` fails on the same blocked `packages/cli/coverage/lcov-report/*.js` artifacts
- Additional unrelated focused failures remain outside this lane:
  - `pnpm exec tsc -p apps/web/tsconfig.json --noEmit --pretty false` fails in `apps/web/src/lib/device-sync/internal-runtime.ts`
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-webhook-idempotency.test.ts --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1` still fails on pre-existing hosted-onboarding expectation drift
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
