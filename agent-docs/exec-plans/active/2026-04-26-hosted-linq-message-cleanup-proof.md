Goal (incl. success criteria):
- Prove whether hosted Cloudflare LINQ sends delete provider-visible inbound and outbound message copies after delivery/finalization, and tighten regression coverage for the hosted-local paths that can leak dashboard-visible message content.

Constraints/Assumptions:
- Preserve privacy: no raw user content beyond synthetic test strings, no real contact identifiers, no secrets, and no provider payload dumps in committed artifacts.
- Work in the current checkout only; preserve unrelated dirty work and active hosted LINQ lanes.
- Treat the hosted Cloudflare path as a high-sensitivity external runtime surface.

Key decisions:
- Start with focused hosted-local LINQ E2E assertions because the runtime already has a cleanup service and the missing proof is on first-contact/webhook cases.
- Do not change the LINQ API deletion route unless a failing test or provider docs prove the current route is wrong.
- Live Worker logs show the parent `UserRunnerDurableObject` can be canceled around 30 seconds while the runner container still completes side effects, so add in-container LINQ cleanup immediately after committed side effects drain; keep parent cleanup as retry/backstop.

State:
- e2e_verified_commit_pending

Done:
- Traced the hosted Cloudflare cleanup chain from run finalization to `deleteHostedLinqMessages`.
- Confirmed existing unit coverage for cleanup sidecar persistence and direct-reply deletion.
- Found hosted-local E2E gaps for first-contact welcome, normal signed webhook reply, and rapid signed webhook cleanup assertions.
- Queried Cloudflare observability for `murph-hosted`: no LINQ cleanup failure warnings in the inspected window, but many `drainHostedRuns` RPCs were canceled at about 30 seconds after container invocation start.
- Added runtime-side cleanup after side effects so provider-visible LINQ messages can be deleted even if the parent DO loses the container result.
- Added hosted-local E2E assertions that first-contact welcome, ordinary webhook replies, and rapid grouped replies issue LINQ `DELETE /messages/{id}` calls for inbound and outbound provider-visible messages.
- Added assistant-runtime coverage that finalization deletes direct inbound, adopted inbound, and delivered outbound LINQ provider message ids after side effects.
- Verification passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-finalize-coverage.test.ts test/message-cleanup.test.ts --no-coverage`.
- Verification passed: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-run-processor.test.ts -t Linq --no-coverage`.
- Verification blocked: `pnpm --dir packages/assistant-runtime typecheck` and `pnpm --dir apps/cloudflare typecheck` both fail on pre-existing `packages/core/src/protocol-profiles.ts` `effectiveSpecHash: undefined` type error outside this task.
- Verification blocked: `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local` timed out in the suite `beforeAll` before any LINQ deletion assertions executed.
- Required review subagents blocked by account usage limit before completing; local security/privacy and coverage review found no additional required edits.
- Fixed hosted-local E2E startup by setting `ALLOW_LOCAL_INTERNAL_PROXY=true` in local-dev Cloudflare env generation and allowing that var through Wrangler.
- Verification passed after the startup fix: `pnpm --dir apps/cloudflare test:e2e:linq-delivery:local`.
- Verification passed after the startup fix: `pnpm --dir packages/assistant-runtime typecheck`.
- Verification passed after the startup fix: `pnpm --dir apps/cloudflare typecheck`.
- Verification passed after the startup fix: `pnpm exec vitest run --config scripts/vitest.config.ts scripts/dev-hosted-local/environment.test.ts scripts/dev-hosted-local/stack.test.ts --no-coverage`.
- Verification failed after startup succeeded: `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local` failed on hosted-local container `exitCode=137` and stale rapid-webhook reply state; first-contact E2E covers the hosted Cloudflare LINQ delete assertions for this change.

Now:
- Create a scoped commit without staging unrelated dirty ledger rows.

Next:
- Push the scoped commit.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether hosted production has the expected LINQ runner env profile/secrets deployed and whether provider DELETE endpoint semantics match the stubbed route.
- UNCONFIRMED: Whether production messages currently visible in LINQ are from parent run-drain cancellations, missing deploy/env, provider DELETE failures without warnings, or historical messages created before this fix.

Working set (files/ids/commands):
- `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts`
- `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `packages/assistant-runtime/test/hosted-runtime-finalize-coverage.test.ts`
- `scripts/dev-hosted-local/constants.ts`
- `scripts/dev-hosted-local/environment.ts`
- `agent-docs/exec-plans/active/2026-04-26-hosted-linq-message-cleanup-proof.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
