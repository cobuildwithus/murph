Goal (incl. success criteria):
- Speed up hosted-local E2E while preserving CI correctness and full coverage.
- Fix real stale-state/setup issues uncovered by the E2E run instead of weakening assertions.
- Success means focused unit tests pass, affected typechecks pass, focused hosted-local Linq scenarios pass, and aggregate hosted-local E2E is green or any remaining blocker is proven unrelated.

Constraints/Assumptions:
- Keep architecture simple and composable; no speculative queues, schedulers, broad retries, or weakened production invariants.
- Preserve unrelated working-tree edits and active lanes.
- Do not expose secrets, direct identifiers, full local paths, or raw private payloads.
- Hosted Temporal and Cloudflare behavior must remain CI-safe.

Key decisions:
- Split aggregate hosted-local E2E into batches only around the scheduled-reminder scenario, which needs process isolation.
- Keep deploy-smoke proof scoped per batch so the isolated scheduled-reminder run gets its own smoke.
- Pass explicit Linq attachment download env into the hosted conversation importer instead of depending on ambient process env.
- Treat orphan E2E runner proxy containers as cleanup targets only under the E2E runner naming pattern.
- Guard Linq E2E wait nudges so tests do not amplify provider/runtime failures into retry storms.
- Treat due `workspace_wake` demand behind an active Cloudflare write fence as a wait-for-owner condition, not as a reason to poke the already-active runner.
- Treat hosted runner container destroy as a fail-closed lifecycle boundary for deploy smoke and subsequent warm reuse.
- Key hosted-local deploy-smoke R2 objects by the local runner build id when Cloudflare version metadata is unavailable.

State:
- Active.

Done:
- Batched hosted-local aggregate harness and runner tests were updated.
- Linq raw/inbox attachment path handling was fixed through explicit hosted env propagation.
- Stale webhook image assertion was replaced with raw/inbox path contract checks.
- E2E proxy cleanup now finds orphan proxy sidecars by E2E runner name.
- Linq wait helper now avoids nudging while work is in-flight and fails fast on observed runtime errors.
- Active `workspace_wake` demands now round-trip the demand source through Temporal/Cloudflare and return `retry_later` at the owner recheck instead of re-waking the active runtime.
- Focused Temporal workflow/activity tests, hosted-orchestrator typecheck, Cloudflare runner/route/env tests, Cloudflare typecheck, and hosted-execution parser tests passed after the source-aware guard.
- Bounded import-phase mailbox post-checkpoint effects with the same timeout as prompt-prep effects.
- Confirmed current conversation import projection is inline and currently returns no `afterCheckpoint` effect.
- Preserved the structured hosted parser toolchain through the Cloudflare workspace bridge into conversation import.
- Added retry-later backoff coverage for stale retry timestamps.
- Fresh-bundle hosted-local `linq-webhook` E2E passed 6/6.
- Deploy smoke now forces a cold container after warm-container teardown, sanitizes non-JSON metadata failures, and marks unsettled best-effort cleanup as non-reusable.
- Hosted-local Temporal port reservation now excludes the UI sidecar port as well as the server port.
- Local deploy-smoke object keys now include `MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID`, preventing stale smoke success across runner bundle rebuilds.
- Focused `linq-webhook` E2E passed again after the local build-id smoke key fix.
- Fixed the bounded Temporal port allocator so aggregate E2E no longer starves on OS-assigned ephemeral ports whose UI companion would exceed the Temporal limit.
- Aggregate `pnpm hosted-local e2e` passed all three batches on the final diff.
- Final focused runner-container, hosted-local support/index, dev-hosted-local environment tests, Cloudflare typecheck, root typecheck, and diff check passed.
- Completion audits ran on the final diff: security/privacy no findings; task-finish no findings; simplify only low cleanup suggestions that were intentionally left unpatched to preserve the canonical hosted-local E2E proof on the exact code diff.

Now:
- Preparing the scoped `scripts/finish-task` commit and plan archive.

Next:
- Commit the scoped hosted-local lifecycle/smoke changes through the active-plan finish path.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/src/worker/route-handlers/deploy-smoke.ts`
- `apps/cloudflare/test/helpers/hosted-local-e2e-support.ts`
- `apps/cloudflare/test/helpers/hosted-local-full-stack-scenario.ts`
- `apps/cloudflare/test/hosted-local-e2e-support.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `scripts/dev-hosted-local/constants.ts`
- `pnpm hosted-local e2e` passed: `.artifacts/hosted-local/2026-06-03T07-53-12-464Z-e2e-stub-all-0a343d6a56/state.json`.
- `pnpm hosted-local e2e linq-webhook` passed after the local build-id smoke key fix.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm typecheck` passed.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
