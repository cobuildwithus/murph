# Harden Cloudflare lane with Workers-runtime tests, gradual deployments, and observability

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Harden the Cloudflare hosted-execution lane by adding a focused Workers-runtime test suite, moving deploy automation onto the versions/deployments rollout model, and enabling first-class Worker observability in Wrangler and CI docs.

## Success criteria

- `apps/cloudflare` keeps a fast Node-targeted Vitest path and gains a smaller Workers-runtime Vitest path that exercises signed dispatch, Durable Object RPC/alarm behavior, bundle journaling, and operator control routes inside the Workers runtime.
- The Cloudflare deploy workflow uploads a version first, then creates an explicit deployment instead of relying on a single `wrangler deploy` step for ordinary rollouts.
- Generated Wrangler config and checked-in scaffold enable Cloudflare observability for logs and traces.
- Cloudflare app docs and repo verification/deploy docs describe the new test split and deployment posture accurately.

## Scope

- In scope:
- `apps/cloudflare` Vitest/package/deploy automation changes
- `apps/cloudflare` runtime tests and test helpers for Workers-runtime coverage
- Cloudflare deploy GitHub workflow and matching docs
- Repo docs whose verification/runtime claims change because of this work
- Out of scope:
- Refactoring hosted runner business logic beyond what the new Workers-runtime tests require
- Changing current bundle/journal semantics beyond deployment or observability wiring
- Live Cloudflare account mutations or rollout execution

## Constraints

- Technical constraints:
- Keep the existing fast Node suite available for most app-local verification.
- Respect the active dirty worktree in `apps/cloudflare`; preserve adjacent hosted runner/package extraction edits.
- Use the Workers Vitest integration only for the smaller boundary suite where runtime fidelity matters.
- Product/process constraints:
- Repo code/test changes require the coordination ledger, execution plan, required checks, and the three mandatory audit subagent passes.
- Deployment automation and docs must stay truthful about Cloudflare versions/deployments limits, including the first-upload and Durable Object migration caveats.

## Risks and mitigations

1. Risk: Versions upload is not valid for first deploys or when a deploy includes Durable Object migrations.
   Mitigation: Keep a guarded direct-deploy path in workflow/docs for first deploy or migration rollouts, and use versions upload/deploy only when the generated config does not introduce new migrations.
2. Risk: Pulling in the Workers Vitest integration forces a repo-wide Vitest bump.
   Mitigation: Minimize the version change to the supported 4.1 line, verify root/package checks, and keep the Cloudflare test scripts explicit.
3. Risk: Existing dirty Cloudflare files overlap deploy/doc surfaces this task needs.
   Mitigation: Read the live file state first, make narrow additive edits, and avoid unrelated runner logic rewrites.

## Tasks

1. Record the lane in the coordination ledger and inspect overlapping dirty Cloudflare files.
2. Add `@cloudflare/vitest-pool-workers` and split `apps/cloudflare` testing into Node and Workers-runtime configs/scripts.
3. Add focused Workers-runtime tests for signed dispatch, Durable Object RPC/alarm behavior, bundle journaling, and operator control paths.
4. Extend deploy automation/workflow to support version upload plus explicit deployments/gradual rollout inputs, while preserving a fallback deploy path for first deploys or migration changes.
5. Enable Worker observability config for logs and traces in checked-in/generated Wrangler config and document expected rollout/observability behavior.
6. Run required verification, gather direct scenario evidence from rendered deploy artifacts and focused runtime tests, then complete simplify/coverage/final-review audit passes.

## Decisions

- Keep the existing Node-targeted app-local tests as the default fast path; add a separate Workers-runtime suite instead of converting the whole Cloudflare package to the Workers pool.
- Use explicit version upload and deployment steps in CI so canary percentages are operator-controlled, instead of forcing all-at-once deploys on every workflow run.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test`
- `pnpm --dir apps/cloudflare test:workers`
- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- `apps/cloudflare test` keeps the fast Node lane green.
- `apps/cloudflare verify` runs app-local typecheck once plus both Cloudflare test paths.
- Repo-required checks pass, or any unrelated failure is explicitly documented with a defensible causal separation.

## Results

- Passed:
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/deploy-worker-version.test.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts apps/cloudflare/test/runner-container.test.ts`
- `pnpm --dir apps/cloudflare test:workers`
- Unrelated repo-wide failures observed after the scoped lane was green:
- `pnpm typecheck` failed in `packages/importers` because `@healthybob/contracts` does not currently export `extractIsoDatePrefix` / `normalizeStrictIsoTimestamp`.
- `pnpm test` failed in `packages/web` because another `next build` process was already running in the environment.
- `pnpm test:coverage` failed in unrelated `apps/web` hosted-onboarding tests.
- Audit note:
- `simplify` and `test-coverage-audit` subagent passes ran earlier in this lane and their findings were applied.
- A `task-finish-review` subagent launch was attempted, but this environment did not surface a retrievable result artifact back to the parent agent.

## Actual outcomes

- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/deploy-worker-version.test.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts apps/cloudflare/test/runner-container.test.ts` passed.
- `pnpm --dir apps/cloudflare test:workers` passed.
- `pnpm typecheck` still fails outside this lane in `packages/importers` because `@healthybob/contracts` is missing the `extractIsoDatePrefix` and `normalizeStrictIsoTimestamp` exports expected by `packages/importers`.
- `pnpm test` still fails outside this lane because `packages/web` hit `Another next build process is already running`.
- `pnpm test:coverage` still fails outside this lane in unrelated `apps/web` hosted-onboarding tests.
