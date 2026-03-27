# Cloudflare Deploy Automation Merge

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Merge the external Cloudflare hosted deploy-automation patch into the current hosted-runner scaffold without overwriting newer runner/runtime/doc changes already present in the worktree.

## Success criteria

- Add the deploy-automation helper module, render scripts, smoke script, workflow, and focused tests under `apps/cloudflare`.
- Keep newer Cloudflare runner/runtime files intact where they already supersede the patch.
- Add the hosted deploy guide as a durable repo doc and route to it from existing docs.
- Update repo docs that currently describe Cloudflare deploy automation as entirely manual so they reflect the new partial automation truthfully.

## Constraints

- Preserve existing dirty edits and prefer manual merges over forcing stale patch hunks.
- Do not downgrade the current `Dockerfile.cloudflare-hosted-runner`, env examples, or hosted-runner runtime behavior when they already exceed the patch.
- Keep deployment automation truthful: worker deploy + secret sync + runner image publication are in scope; automatic rollout of the separate runner service is still out of scope.

## Verification

- Focused test: `pnpm --dir ../.. exec vitest run apps/cloudflare/test/deploy-automation.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1` passed.
- Direct scenario proof: rendered generated deploy artifacts into `apps/cloudflare/.deploy` with isolated sample env and confirmed the files landed there, the generated config included the expected worker URLs, the worker-secret payload included the expected key set, and the runner env carried `HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS=45000`.
- Required repo checks:
  - `pnpm typecheck` passed.
  - `pnpm test` failed in unrelated in-flight `apps/web` work because Vitest referenced missing `apps/web/test/hosted-onboarding-passkeys.test.ts` and `apps/web/test/hosted-onboarding-service-passkeys.test.ts`.
  - `pnpm test:coverage` failed in unrelated in-flight `apps/web` work because generated `.next/types/**` and source files still referenced removed passkey/Privy modules; focused Cloudflare suite runs also still surfaced the pre-existing unrelated `apps/cloudflare/test/node-runner.test.ts` failure (`VaultError: Food was not found.`).
- Mandatory audit passes:
  - `simplify`: no actionable simplification issues found.
  - `test-coverage-audit`: added narrow failure-path coverage for non-HTTPS deploy URLs and invalid runner commit-timeout overrides; focused test rerun passed.
  - `task-finish-review`: no findings in the scoped Cloudflare deploy-automation diff.

## Outcome

- Landed the manual GitHub Actions deploy workflow, deploy-artifact render helpers, durable deploy guide, and focused tests without replacing the newer runner Dockerfile or env/runtime surface already present in the repo.
- Preserved current runner commit-timeout support by threading it through the new helper, workflow, tests, and deploy docs.
