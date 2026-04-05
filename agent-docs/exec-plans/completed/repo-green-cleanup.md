# Repo Green Cleanup

## Goal

Finish the remaining repo blockers so the top-level verification suite is fully green, the current dirty worktree is resolved, and the result is committed cleanly.

## Success Criteria

- The Cloudflare hosted-runner runtime config fix is landed so worker-only runtime knobs survive into per-job execution.
- The CLI inbox/setup Vitest workspace is stable under the default root test run.
- Required verification for the touched scope and repo top-level gates passes.
- The worktree is clean after the scoped commit.

## Constraints

- Preserve unrelated work if any new overlap appears.
- Keep hosted runner config boundaries explicit: forwarded child env stays separate from worker-only runtime config, but both must influence the effective per-job runtime.
- Use the repo commit helpers rather than ad hoc commits if this plan stays active through completion.

## Current Scope

- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/runner-env.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/runner-env.test.ts`
- `apps/cloudflare/test/user-runner.test.ts`
- `packages/cli/vitest.workspace.ts`

## Verification

- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck`
- `pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage --project cli-inbox-setup`
- `pnpm --dir ../.. exec vitest run apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/runner-env.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage --project cloudflare-node-runner`
- `pnpm test`
- `pnpm test:coverage`

## Audit Outcome

- `simplify` review found one medium issue: the node-runner path still leaked worker-only `HOSTED_EXECUTION_*` runtime knobs into child forwarded env. Fixed by stripping those keys from child forwarding while still using them as runtime-config inputs, plus a regression test in `apps/cloudflare/test/node-runner.test.ts`.
- Final `task-finish-review` returned no findings.

## Planned Steps

1. Confirm the remaining repo-level failure and reduce it to a reproducible scoped cause.
2. Patch the hosted runner runtime config path and the unstable CLI test-project configuration.
3. Rerun the scoped and repo-wide verification lanes until green, then complete the required audits and commit.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
