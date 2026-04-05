# Hosted Architecture Simplification Follow-Up

## Goal

Land the supplied final hosted simplification patch against the current repo snapshot without overwriting unrelated worktree edits.

## Scope

- Remove the last Cloudflare-to-web bearer-token seam for hosted device connect-link creation and switch that path to the shared HMAC-signed request model while keeping the bound user header.
- Make the runner container lifecycle explicitly one-shot in code and remove the stale `HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER` config/docs surface.
- Update durable docs and focused tests so the repo describes the current hosted trust boundary and container lifecycle accurately.

## Constraints

- Treat this as a high-risk trust-boundary/runtime landing across `apps/cloudflare`, `apps/web`, and `packages/hosted-execution`.
- Preserve unrelated dirty-tree edits already present in the repo.
- Port the patch intent onto the current split-file structure instead of forcing the historical patch snapshot.

## Verification

- Focused proof: `pnpm vitest run --coverage.enabled=false apps/web/test/hosted-execution-internal.test.ts apps/web/test/device-sync-internal-connect-route.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/deploy-automation.test.ts packages/hosted-execution/test/hosted-execution.test.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Status

- Completed

## Outcome

- Audit follow-up fixed the stale warm-container claim in `agent-docs/operations/verification-and-runtime.md`.
- The internal device-sync connect-link route test now exercises real signed-request verification and rejection instead of mocking the auth helper.
- `pnpm typecheck` passed.
- `pnpm test` still fails on the pre-existing hosted-web assertion in `apps/web/test/device-sync-settings-routes.test.ts` that expects `"Connected and syncing normally"` but receives `"Connected"`.
- `pnpm test:coverage` still fails on the same hosted-web test failure plus the pre-existing coverage thresholds for `packages/hosted-execution/src/{client.ts,env.ts,routes.ts}`.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
