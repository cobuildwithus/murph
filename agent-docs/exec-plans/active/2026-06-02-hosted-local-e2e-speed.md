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

Now:
- Holding broad hosted-local matrix while an interactive `pnpm dev` stack is active to avoid competing local state.

Next:
- Re-run aggregate hosted-local E2E in a clean window, or keep validation scoped to fresh-bundle Linq webhook plus focused unit/build/type checks.
- Complete scoped reviews and handoff.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the aggregate hosted-local default matrix is green after the latest changes; the broad run was interrupted intentionally because an interactive dev stack was active.

Working set (files/ids/commands):
- `packages/hosted-local-harness/src/e2e.ts`
- `scripts/hosted-local-e2e.test.ts`
- `apps/cloudflare/test/run-hosted-local-e2e-runner.test.ts`
- `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`
- `apps/cloudflare/test/helpers/hosted-local-linq-support.ts`
- `scripts/dev-hosted-local/runtime.ts`
- `scripts/dev-hosted-local/runtime.cleanup.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/helpers/hosted-local-wake.test.ts`
- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `packages/hosted-orchestrator-temporal/src/activities/ensure-runtime-processing.ts`
- `packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts`
- `packages/hosted-orchestrator-temporal/test/ensure-runtime-processing.test.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
