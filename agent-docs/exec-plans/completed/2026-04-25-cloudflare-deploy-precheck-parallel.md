# Cloudflare Deploy Precheck Parallelization

## Goal

Reduce the Cloudflare hosted deploy wall clock without weakening the deploy gates by running focused Cloudflare checks and the pre-deploy runner container smoke concurrently after deploy artifacts and the cached runner base image are ready.

Success criteria:

- Production deploy artifacts are still rendered before any deploy gate.
- `apps/cloudflare verify:parallel` still runs for deploy and render-only workflow invocations.
- `apps/cloudflare runner:docker:smoke:prepared-base` still runs before `deploy:worker:apply` when `deploy_worker` is true.
- The workflow test suite proves the expected gating shape.
- `pnpm cf:deploy` completes successfully after the scoped commit.

## Constraints

- Preserve unrelated active work in the shared checkout.
- Do not remove deploy correctness gates, only overlap independent gates.
- Keep the production `.deploy/runner-bundle/` as the Worker upload artifact; smoke continues to use the isolated smoke bundle path from the previous cleanup.
- Avoid printing secrets or environment values from deploy tooling.

## Scope

Expected files:

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/DEPLOY.md`
- this plan and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification Plan

- Focused Cloudflare deploy automation tests.
- `pnpm --dir apps/cloudflare typecheck`.
- Scoped `bash scripts/workspace-verify.sh test:diff ...` for touched workflow/doc/test files.
- Required completion audits for a deploy-surface change.
- Scoped commit through `scripts/finish-task`.
- `pnpm cf:deploy` and inspect the GitHub Actions result and timing.

## State

- 2026-04-25: Plan opened. No implementation changes yet.
- 2026-04-25: Workflow now overlaps `verify:parallel` and `runner:docker:smoke:prepared-base` for deploy runs, keeps a render-only `verify:parallel` fallback, and documents/tests the scheduling contract.
- 2026-04-25: Focused deploy automation test, app typecheck, YAML parse, diff whitespace check, scoped `test:diff`, and direct `verify:parallel` all passed. Required audit workers are running.
- 2026-04-25: Coverage audit added a test-only ordering assertion for combined checks after artifacts/base image. Security/privacy found no blocking issues and requested a stronger guard that combined checks precede `Deploy Worker`; added that test-only assertion locally.
- 2026-04-25: Post-audit reruns passed: deploy automation Vitest, Cloudflare typecheck, YAML parse, diff whitespace check, scoped `test:diff`, and direct `verify:parallel`.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
