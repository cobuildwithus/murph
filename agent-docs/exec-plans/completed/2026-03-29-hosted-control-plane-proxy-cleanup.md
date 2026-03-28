# 2026-03-29 Hosted Control-Plane Proxy Cleanup

## Goal

- Make user-bound hosted web control-plane traffic explicitly proxy-only from runner contexts, remove dead replay-filter state, hard-cut the remaining `outbox.worker` aliasing, replace onboarding-wide web base fallback semantics with one explicit hosted web base, and centralize internal web route auth plus bound-user enforcement.

## Scope

- `packages/hosted-execution/src/{web-control-plane.ts,callback-hosts.ts,env.ts}`
- `packages/assistant-runtime/src/{hosted-device-sync-runtime.ts,hosted-runtime/environment.ts,hosted-runtime/events/share.ts,hosted-runtime/models.ts}`
- `apps/cloudflare/src/{runner-container.ts,runner-outbound.ts,user-runner/runner-queue-store.ts,user-runner/types.ts}`
- `apps/web/src/lib/hosted-execution/internal.ts`
- `apps/web/app/api/internal/device-sync/runtime/**`
- `apps/web/app/api/internal/hosted-execution/usage/record/route.ts`
- `apps/web/app/api/hosted-share/internal/[shareId]/payload/route.ts`
- Targeted tests and docs needed to keep the hosted auth/env boundary truthful
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Findings

- Runner-owned user-bound web control-plane calls now resolve through explicit proxy clients in `packages/hosted-execution`; direct server clients remain available for device-sync and usage, while hosted share payload reads are proxy-only from runner/runtime paths.
- `HOSTED_WEB_BASE_URL` is now the shared hosted web/control-plane fallback; Cloudflare runner env forwarding no longer carries `HOSTED_ONBOARDING_PUBLIC_BASE_URL` as the generic catch-all.
- Internal hosted web routes now share one auth/bound-user policy helper, closing the prior usage-route gap and enforcing body/header user-id consistency at the route boundary.
- The dead `consumed_event_replay_filter` state is removed from active queue-store logic; schema bootstrap only drops the legacy table if present.
- `side-effects.worker` is now the only callback hostname for committed side-effect persistence; the `outbox.worker` alias is removed from runtime code and targeted docs/tests.

## Constraints

- Preserve overlapping dirty edits in hosted runtime, hosted web, and Cloudflare runner files already claimed by adjacent lanes.
- Keep runner-side user-bound calls proxy-only; do not reintroduce runner access to broad web control tokens.
- Prefer one explicit hosted web/control-plane base fallback and route-specific overrides only where necessary.
- Remove dead replay-filter state fully instead of leaving schema/hash/cache remnants behind.

## Plan

1. Inspect the current hosted-execution, assistant-runtime, apps/web, and Cloudflare paths to map proxy-vs-direct calls, token/header handling, and route auth duplication.
2. Introduce a first-class worker-proxy client shape in `packages/hosted-execution` for runner-owned user-bound calls and align assistant-runtime/Cloudflare callers to it.
3. Remove `outbox.worker` aliasing, rename broad onboarding fallback semantics to an explicit hosted web/control-plane base, and update route/base resolution helpers.
4. Centralize internal-route auth and bound-user policy on the hosted web side, then apply it to device-sync, share, and usage routes.
5. Delete the dead consumed-event replay filter state from the Cloudflare user-runner store/types and update focused tests.
6. Run focused regressions plus required repo verification, then mandatory `simplify` and `task-finish-review` subagent passes before commit, with coverage/proof-gap review handled inside the final audit.

## Verification

- Focused hosted package tests:
  - `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --no-coverage --maxWorkers 1`
  - Passed.
- Focused hosted assistant-runtime tests:
  - `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-http.test.ts packages/assistant-runtime/test/hosted-runtime-usage.test.ts --no-coverage --maxWorkers 1`
  - Passed.
- Focused hosted web tests:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-execution-usage.test.ts --no-coverage --maxWorkers 1`
  - Passed.
- Focused Cloudflare tests:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-runner.test.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1`
  - Passed.
- Required repo wrappers:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
  - `pnpm typecheck` failed outside this lane in `packages/contracts` (`scripts/generate-json-schema.ts` / `scripts/verify.ts` module-resolution and implicit-`any` errors).
  - `pnpm test` failed outside this lane in `packages/web/test/overview.test.ts` (`currentProfile?.topGoals[0]?.title` was `undefined` instead of `"Protect sleep consistency"`).
  - `pnpm test:coverage` failed for the same unrelated `packages/web/test/overview.test.ts` assertion after the wrapper rebuilt the workspace.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
