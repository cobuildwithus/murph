# Hosted Device Connect Smoke

## Goal

Add an executable hosted-local E2E smoke proving hosted device-connect capability is configured from the Cloudflare runner environment and can create a WHOOP connect link through the signed hosted web callback path.

## Constraints

- Keep Cloudflare as a thin runner over local runtime semantics.
- Do not forward raw WHOOP provider credentials into the isolated runner child environment.
- Do not hit live WHOOP or other external wearable providers.
- Preserve unrelated active dirty-tree work.

## Plan

1. Add a focused hosted-local device-connect E2E test.
2. Include the new test in the hosted-local aggregate runner and a targeted package script.
3. Update direct script/contract tests and durable verification docs.
4. Run focused tests, typecheck/diff checks, then commit only task hunks.

## Verification

- `pnpm --dir apps/cloudflare test:e2e:device-connect:local` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/container-image-contract.test.ts --no-coverage` passed.
- `pnpm typecheck` passed before later unrelated dev-hosted-local edits appeared in the dirty checkout.
- `pnpm --dir apps/cloudflare typecheck` is currently blocked by unrelated active dev-hosted-local edits in `scripts/dev-hosted-local/environment.ts`, `scripts/dev-hosted-local/types.ts`, and `scripts/dev-hosted-local/config.ts`.
- `git diff --check` passed for this task's touched paths.
