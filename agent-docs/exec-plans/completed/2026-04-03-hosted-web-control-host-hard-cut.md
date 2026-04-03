# Hosted Web Control Host Hard Cut Plan

## Goal

Remove the split-host runner web-control allowlist feature so hosted Cloudflare execution only supports runner proxy calls back to the shared hosted web host.

## Scope

- Remove `HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS` from the Cloudflare worker runtime contract, runner outbound allowlist logic, deploy automation, tests, docs, and deploy workflow wiring.
- Keep the shared-host control-plane path through `HOSTED_WEB_BASE_URL` and the existing split base URL overrides, but require those overrides to use the same host as the shared hosted-web base URL.

## Constraints

- Preserve the existing fail-closed runner proxy behavior for missing base URLs or missing control tokens.
- Do not disturb unrelated in-flight hosted runtime, deploy, or workout changes elsewhere in the dirty worktree.
- Keep the cutover narrow: remove the escape hatch rather than redesigning the control-plane routing model.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/deploy-automation.test.ts --coverage.enabled=false --maxWorkers 1`

## Outcome

- Removed `HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS` from the Cloudflare worker env contract, deploy automation, runtime helper logic, and focused tests.
- Kept route-specific hosted web control-plane base URL overrides, but documented and enforced that they must stay on the same host as `HOSTED_WEB_BASE_URL`.
- Updated the hosted web README so repo-level env guidance matches the Cloudflare hard cut.
- Repo-wide verification remained red for pre-existing unrelated workspace and hosted-web smoke issues, but focused Cloudflare typecheck and the touched runner/deploy tests passed.

Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
