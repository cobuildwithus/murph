# Cloudflare Pre-Deploy Fixes

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

Close the remaining concrete Cloudflare hosted-runner pre-deploy gaps without changing the overall hosted execution architecture.

## Scope

- Prevent stale past `nextWakeAt` values from being reused after an alarm or completed run.
- Set an explicit native-container `instance_type` in both the checked-in Wrangler scaffold and generated deploy config.
- Strengthen deploy smoke validation so a manual `/run` must drain, advance status, and expose durable bundle refs before smoke passes.
- Move transient execution-journal and side-effect journal R2 objects under lifecycle-friendly top-level prefixes and delete execution journal entries once a committed dispatch has been fully applied.
- Remove or clarify local-dev config that still assumes public runner callback loopback behavior, and keep docs/examples truthful about local Worker/container behavior.
- Fail closed when the worker or native container control tokens are unset instead of leaving internal control paths effectively open.
- Preserve warm native-container reuse between per-user batches by removing unconditional post-batch teardown and documenting the keep-warm boundary explicitly.

## Constraints

- Preserve the current Worker + Durable Object + Cloudflare `Container` design.
- Do not weaken the durable replay semantics for commit/finalize recovery or assistant-delivery dedupe.
- Keep local-dev and deploy config truthful to the current Wrangler schema already in the repo.
- Preserve adjacent dirty worktree edits in Cloudflare docs/tests/config.

## Risks

1. Over-aggressive journal cleanup could break duplicate-dispatch recovery or assistant-delivery dedupe.
   Mitigation: only delete execution-journal records after `applyCommittedDispatch()` has durably advanced queue state; keep side-effect journal reads compatible with both new and legacy key layouts.
2. Smoke checks can become flaky if they poll the wrong completion signals.
   Mitigation: key smoke success off stable operator status fields that already exist (`pendingEventCount`, `lastRunAt`, `bundleRefs`) and allow bounded polling.
3. Container-size config can drift between the checked-in scaffold and generated deploy output.
   Mitigation: drive both from the same deploy-automation shape and add direct config assertions in tests.
4. Failing closed on missing control tokens could break local/manual testing paths that implicitly relied on open routes.
   Mitigation: keep `/` and `/health` public, keep signed dispatch unchanged, make local examples and docs explicit about the now-required control tokens, and cover the new misconfiguration responses in worker/container tests.
5. Removing forced post-batch teardown could leave stale per-user process state around longer than expected.
   Mitigation: rely on the existing isolated child-process runner per request, keep `sleepAfter` short, and add focused assertions that warmed containers no longer receive unconditional destroy calls.

## Verification Plan

- Focused `apps/cloudflare` tests while iterating.
- Direct scenario proof by rendering/generated deploy config and running the smoke helper against a mocked status progression.
- Required repo commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Required completion-workflow audit passes via spawned subagents for simplify, coverage, and final review.

## Current State

- The Cloudflare runtime slice is complete:
  - checked-in and generated Wrangler config pin explicit native-container sizing (`basic` by default, overrideable via `CF_CONTAINER_INSTANCE_TYPE`)
  - generated deploy config no longer emits Wrangler `secrets.required`
  - local dev/docs no longer describe a public callback loopback path and now describe the fail-closed control-token requirement truthfully
  - hosted deploy smoke now requires a manual `/run` to drain, advance `lastRunAt`, and expose durable bundle refs before passing
  - stale past `nextWakeAt` values are cleared before alarm work resumes and new wake selection only retains future hints
  - execution-journal entries move under a transient prefix, keep legacy-read compatibility, and are deleted after durable recovery/application succeeds
  - side-effect journal keys now write under transient lifecycle-friendly prefixes while still reading legacy layouts
  - the Worker/container path fails closed on missing control tokens and keeps containers warm until `sleepAfter` instead of forcing immediate teardown

## Verification Results

- Passed: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts --no-coverage --maxWorkers 1`
- Passed: `pnpm --dir apps/cloudflare verify`
- Passed direct scenario proof: `pnpm --dir apps/cloudflare deploy:smoke` against a local mock worker/status server, confirming queue-drain polling plus durable bundle-ref checks.
- Passed focused runner-container verification after the final simplify cleanup: `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-container.test.ts --no-coverage --maxWorkers 1`
- Completion-workflow audit passes were completed for `simplify`, `test-coverage-audit`, and `task-finish-review`.
  - `simplify`: one actionable cleanup was applied in `runner-container.ts` to narrow runner-control-token types and remove dead null branches
  - `test-coverage-audit`: no additional high-impact test was required; current Cloudflare tests already cover the highest-risk deltas
  - `task-finish-review`: no actionable issues remained in the bounded Cloudflare scope
- Repo-wide required wrappers remain red for unrelated worktree issues outside this slice:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
Completed: 2026-03-28
