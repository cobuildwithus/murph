# Runner success recycle canary

## Goal

Remove the low production warm-shell recycle pressure from the hosted runner by
raising the clean-success recycle threshold from 25 to 100 while preserving the
existing health, cleanup, deploy-smoke, failure, and activity-expiry recycle
paths.

Success criteria:

- Default and documented `HOSTED_EXECUTION_RUNNER_RECYCLE_AFTER_SUCCESS_COUNT`
  value is 100.
- Focused runner lifecycle tests still prove the count-based recycle knob works.
- No new lifecycle owner, scheduler, or checkpoint path is introduced.
- Focused Cloudflare verification passes or any unrelated blocker is recorded.

## Constraints

- Preserve unrelated worktree edits and active plans.
- Keep hosted runner lifecycle simple: this is a canary default change, not a
  redesign of shell health policy.
- Do not expose local user identifiers, secret values, raw payloads, home paths,
  or provider credentials in committed docs, tests, logs, or handoff text.
- Be careful around the existing hosted runner destroy-timeout active plan, which
  also touches `apps/cloudflare/src/runner-container.ts`.

## Approach

1. Update the hard-coded default and docs from 25 to 100.
2. Keep the focused test that overrides the env to 2, proving the knob remains
   available as a safety backstop.
3. Run the focused runner-container test and the applicable Cloudflare verify
   lane.
4. Run required review passes, then close this plan with a scoped commit.

## State

Complete; closing with scoped commit.

## Notes

- Current docs already say activity expiry is cleanup-only and successful
  invocations should keep the warm shell unless a safety condition fails.
- The existing 25-success default appears to be a legacy blunt safety valve from
  before the current cleanup verification, poisoning, health, deploy-smoke, and
  failed-invocation teardown paths were in place.
- Focused recycle test passed:
  `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-container.test.ts --testNamePattern "recycle"`.
- Cloudflare app verify passed: `pnpm --dir apps/cloudflare verify`.
- Diff-aware verification passed:
  `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/README.md apps/cloudflare/DEPLOY.md agent-docs/exec-plans/active/2026-06-21-runner-success-recycle-canary.md`.
- Security/privacy audit: no findings.
- Coverage-write audit: no coverage changes needed.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
Completed: 2026-06-21
