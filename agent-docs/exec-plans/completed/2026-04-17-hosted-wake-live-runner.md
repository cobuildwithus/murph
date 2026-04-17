## Goal

Land the supplied HostedWake live-runner and direct-producer cutover slice in the current tree without widening beyond the returned patch intent.

## Scope

- `apps/cloudflare/src/{index.ts,user-runner.ts,worker-routes/shared.ts}`
- `apps/cloudflare/src/web-control-plane.ts`
- `apps/cloudflare/test/user-runner-hosted-wake.test.ts`
- `packages/cloudflare-hosted-control/src/{client.ts,routes.ts}`
- `packages/hosted-execution/src/{contracts.ts,parsers.ts}`
- `apps/web/src/lib/{hosted-execution/control.ts,hosted-execution/outbox.ts}`
- `apps/web/src/lib/hosted-wake/{control.ts,dispatch.ts,flags.ts,store.ts}`
- `apps/web/src/lib/{device-sync/wake-service.ts,hosted-share/acceptance-service.ts}`
- `apps/web/src/lib/hosted-onboarding/{billing-success-service.ts,stripe-revnet-reconciliation.ts,webhook-receipt-store.ts,webhook-service.ts}`
- focused hosted-web and hosted-runner tests for the landed behavior

## Constraints

- Keep the change scoped to the supplied patch intent: wake-trigger route/client support, live runner wake draining, and direct-routing handoff for the named producers only.
- Preserve existing `execution_outbox` behavior as the fallback when wake routing flags are off or a wake append cannot be used.
- Avoid unrelated hosted execution, onboarding, or Cloudflare runner refactors in files already touched elsewhere in the worktree.
- Do not expose secret values from `.env` files; only adjust checked-in examples or code paths as needed.

## Verification

- Repo-required scoped verification for touched `apps/web`, `apps/cloudflare`, and shared package surfaces
- Required completion workflow audit passes for this high-risk repo change
- Recursive same-thread follow-up helper after verification and commit

## Evidence

- `pnpm typecheck`
  - Passed.
  - Pre-existing workspace-boundary warnings remain for `apps/cloudflare/test/hosted-local-linq-{first-contact,webhook}-e2e.test.ts` importing `apps/web` through relative paths.
- `pnpm test:diff apps/cloudflare/src/index.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/worker-routes/shared.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/user-runner.test.ts apps/web/src/lib/device-sync/wake-service.ts apps/web/src/lib/hosted-execution/control.ts apps/web/src/lib/hosted-execution/outbox.ts apps/web/src/lib/hosted-onboarding/billing-success-service.ts apps/web/src/lib/hosted-onboarding/stripe-revnet-reconciliation.ts apps/web/src/lib/hosted-onboarding/webhook-receipt-store.ts apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/src/lib/hosted-share/acceptance-service.ts apps/web/src/lib/hosted-wake/control.ts apps/web/src/lib/hosted-wake/dispatch.ts apps/web/src/lib/hosted-wake/flags.ts apps/web/src/lib/hosted-wake/store.ts apps/web/test/hosted-execution-outbox.test.ts packages/cloudflare-hosted-control/src/client.ts packages/cloudflare-hosted-control/src/routes.ts packages/cloudflare-hosted-control/test/client.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/test/hosted-wake-parsers.test.ts`
  - All affected package and app test/typecheck lanes passed.
  - `apps/web verify` still fails in `dev:smoke` because `vercel env run` starts an interactive device-login flow with no cached credentials; this is unrelated to the landed diff.
- Direct scenario proof:
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-hosted-wake.test.ts`
  - Passed; confirms a poisoned wake now advances the hosted cursor and does not strand later wakes.
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
