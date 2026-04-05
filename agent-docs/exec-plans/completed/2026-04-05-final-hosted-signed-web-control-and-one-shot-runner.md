# Final Hosted Signed Web Control And One-Shot Runner

## Goal

Land the supplied hosted signed web-control and one-shot runner cleanup patch against the current repo snapshot without disturbing overlapping dirty-tree edits.

## Scope

- Remove the remaining Cloudflare-to-web runtime bearer-token seams in favor of the shared HMAC-signed control model.
- Keep the bound-user header and enforce body scope where the hosted web routes still accept runner-supplied bodies.
- Delete the dead hosted web outbox-drain route.
- Make runner containers truly one-shot and remove the stale `HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER` config and docs surface.
- Align shared hosted web-control env/config/docs around signing-secret based runtime/share/usage control.

## Constraints

- Treat this as a high-risk hosted trust-boundary and runtime-entrypoint patch landing.
- Preserve unrelated dirty-tree edits already present in the repo.
- Preserve overlapping dirty hosted-runner auth edits and fold them into the final shape instead of reverting them.
- Do not broaden into hosted share-link creation auth or scheduler-token redesign.

## Verification

- Focused hosted web-control and runner tests for the touched Cloudflare/web/package paths.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Implementation complete; final audit and scoped commit in progress.

## Verification Results

- Passed: `pnpm --dir packages/hosted-execution exec vitest run test/hosted-execution.test.ts --coverage.enabled=false`
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-internal.test.ts apps/web/test/device-sync-internal-connect-route.test.ts --no-coverage`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-usage.test.ts test/hosted-runtime-http.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-events.test.ts --coverage.enabled=false`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts test/hosted-device-sync-oura-delete-hint.test.ts --coverage.enabled=false`
- Failed, unrelated baseline: `pnpm typecheck` due to missing names `showResultSchema` and `listResultSchema` in `packages/cli/src/vault-cli-command-manifest.ts`
- Failed, unrelated baseline: `pnpm test` due to `packages/cli/test/incur-smoke.test.ts` still expecting older `timeline` help text
- Failed, unrelated baseline: `pnpm test:coverage` due to that same CLI smoke assertion plus existing hosted-execution coverage threshold misses in `packages/hosted-execution/src/client.ts`, `env.ts`, and `routes.ts`
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
