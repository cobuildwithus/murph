# Remove runner success recycle limit

## Goal

Fully remove the hosted runner's count-based warm-shell recycle policy.

Success criteria:

- No `HOSTED_EXECUTION_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT` runtime surface.
- No `success-recycle` destroy reason, success counter, or success-count reader.
- Successful clean invocations keep the warm shell until an actual health,
  failure, deploy-smoke, explicit cleanup, or activity-expiry lifecycle event.
- Focused runner tests and Cloudflare verification pass.

## Constraints

- Preserve unrelated working-tree edits.
- Keep the lifecycle model simple; do not replace the count limit with another
  synthetic scheduler or policy abstraction.
- Do not expose secrets, payloads, local identifiers, or home paths.
- Be careful around existing hosted runner and snapshot active-plan rows.

## Approach

1. Delete the success-count recycle code path and env parser.
2. Remove docs for the deleted env var.
3. Replace count-recycle tests with proof that repeated clean invocations do not
   destroy the warm shell by count.
4. Run focused and app-owner verification, required reviews, and close with a
   scoped commit.

## State

Complete; closing with scoped commit.

## Notes

- The remaining recycle/stop triggers are concrete health or lifecycle events:
  failed invocation, failed readiness, stale/failed warm health, deploy smoke,
  explicit cleanup, unsettled cleanup invalidation, and idle activity expiry.
- Focused no-count test passed:
  `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-container.test.ts --testNamePattern "successful invocation count"`.
- Cloudflare app verify passed: `pnpm --dir apps/cloudflare verify`.
- Diff-aware verification passed:
  `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/README.md apps/cloudflare/DEPLOY.md agent-docs/exec-plans/active/2026-06-21-remove-runner-success-recycle.md`.
- Coverage-write audit: no coverage changes needed; reran focused proof.
- Security/privacy audit: no findings.
- Deep review: no scoped findings. It noted an unrelated dirty snapshot-restore
  memory risk in `apps/cloudflare/src/workspace-snapshot-local.ts`, outside this
  task's commit scope.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
