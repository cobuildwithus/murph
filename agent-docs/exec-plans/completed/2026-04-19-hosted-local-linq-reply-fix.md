## Title

Fix the hosted-local Linq reply regression caused by persisting container-only assistant endpoints.

## Goal

Keep local hosted Linq delivery working inside the runner container while preventing hosted assistant bootstrap from persisting `host.docker.internal` into the saved platform profile. Land the smallest greenfield fix that keeps container-only callback URLs container-only and keeps saved hosted assistant config host-runnable.

## Scope

- `apps/cloudflare/src/{hosted-env-policy,runner-env,node-runner}.ts`
- `apps/cloudflare/src/user-runner/runner-wake-processor.ts`
- `packages/operator-config/src/hosted-assistant-config.ts`
- focused regression coverage in `packages/operator-config/test/hosted-assistant-bootstrap.test.ts`
- focused hosted-local Linq e2e checks in `apps/cloudflare/test/hosted-local-{linq-first-contact,linq-webhook}-e2e.test.ts`

## Constraints

- Do not edit `scripts/dev-hosted-local/stack.ts`, `scripts/dev-hosted-local/stack.test.ts`, or `scripts/vitest.config.ts`.
- Preserve unrelated dirty-tree hosted-wake, hosted-email, and hosted-onboarding edits already in flight.
- Keep fixes bounded to the hosted assistant bootstrap/persistence seam plus the runner env wiring it depends on; do not broaden into general hosted onboarding or deploy cleanup.

## Verification

- `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts test/hosted-assistant-bootstrap.test.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-context-coverage.test.ts --no-coverage`
- `env -u NODE_OPTIONS pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-runner apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/node-runner.test.ts --no-coverage`
- `env -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts -t "sends a Linq reply after a later inbound Linq message" --no-coverage`
- `env -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts -t "routes a signed Linq webhook through apps/web and delivers the follow-up reply" --no-coverage`
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm typecheck` (currently fails for pre-existing unrelated assistant-engine boundary exports and `packages/assistantd/test/http-coverage.test.ts`)

## Notes

- Root cause: `buildHostedRunnerContainerEnv()` correctly rewrites loopback callback URLs to `host.docker.internal` for the real container, but hosted assistant bootstrap was also reading that rewritten env and persisting the container-only assistant base URL into the saved `platform-default` profile.
- Incorrect attempted fix: swapping the whole wake processor to ambient env under the local bridge fixed saved config but broke first-contact Linq delivery by making the container call `127.0.0.1`.
- Final fix direction: keep container env forwarding for real container execution, keep ambient-env fallback only for host/manual runtime envelopes that omit `forwardedEnv`, and normalize only `HOSTED_ASSISTANT_BASE_URL` inside hosted assistant bootstrap when the local bridge marker shows the base URL is container-rewritten.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
