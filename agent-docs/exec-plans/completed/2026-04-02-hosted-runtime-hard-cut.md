# 2026-04-02 Hosted Runtime Hard Cut

## Goal

- Remove the remaining hosted runtime input contract for callback base URLs and partial web control-plane overrides so the Cloudflare worker owns those surfaces entirely.

## Scope

- `agent-docs/exec-plans/active/{2026-04-02-hosted-runtime-hard-cut.md,COORDINATION_LEDGER.md}`
- `packages/assistant-runtime/src/hosted-runtime/{models.ts,parsers.ts,environment.ts}`
- `packages/assistant-runtime/test/hosted-runtime-parsers.test.ts`
- `apps/cloudflare/src/{node-runner.ts,runner-env.ts}`
- focused `apps/cloudflare/test/{node-runner.test.ts,runner-env.test.ts}`

## Findings

- The public hosted runtime config still models deprecated override fields for callback base URLs and partial web control-plane input.
- Cloudflare node-runner no longer needs those fields for production behavior, but the test harness still injects them through a local callback override hook.
- Existing share/device-sync/usage control-plane env variables already cover the worker-owned runtime path. Artifact/commit/email/side-effect callback URLs can stay fixed to the worker defaults.

## Constraints

- Preserve the current hosted execution behavior and only delete dead compatibility surface.
- Preserve unrelated dirty-tree edits already present in the repo.
- Keep test coverage focused on the affected hosted runtime and node-runner paths.

## Plan

1. Remove deprecated callback/control-plane override fields from the hosted runtime input model and parser.
2. Make hosted runtime normalization derive callback URLs from fixed worker defaults and derive control-plane values from forwarded env only.
3. Remove the node-runner callback override test hook and update focused tests to use env or fetch proxying instead.
4. Run focused verification plus required checks, then close and commit the scoped cleanup.

## Verification Target

- Focused `apps/cloudflare/test/{node-runner,runner-env}.test.ts`
- Focused `packages/assistant-runtime/test/hosted-runtime-parsers.test.ts`
- `apps/cloudflare` and `packages/assistant-runtime` typecheck, then repo `pnpm typecheck` and `pnpm test` if the current tree allows it

## Status

- Completed
- Updated: 2026-04-02

## Outcome

- The exported hosted runtime input contract no longer accepts callback base URL fields or partial `webControlPlane` overrides.
- Hosted runtime normalization now owns callback URLs from fixed worker defaults and derives web control-plane values from forwarded env only.
- The isolated hosted runtime path now sends the raw runtime envelope to the child and keeps normalization child-local, so the hard-cut parser only applies at the public boundary.
- Focused node-runner tests now use forwarded-env test overrides or fetch proxying instead of runtime URL injection.

## Verification Result

- `./node_modules/.bin/vitest run --coverage=false --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/runner-env.test.ts`
- `pnpm exec vitest run --config vitest.config.ts test/hosted-runtime-parsers.test.ts test/hosted-runtime-isolated.test.ts --no-coverage` in `packages/assistant-runtime`
- `./node_modules/.bin/tsc -p apps/cloudflare/tsconfig.json --pretty false`
- `./node_modules/.bin/tsc -p packages/assistant-runtime/tsconfig.typecheck.json --pretty false`
- `pnpm typecheck`
- `pnpm test`
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
