# Fix device-sync handoff review issues

Status: completed
Created: 2026-06-05
Updated: 2026-06-06

## Goal

- Resolve the deep-review findings on PR 52 without reintroducing device-sync
  recovery as a current correctness path.
- Keep the durable dirty-state plus bounded `device-sync.wake` mailbox handoff
  architecture simple, while preserving Temporal replay safety for old
  histories.

## Success criteria

- Public hosted-execution/web contracts continue to reject current
  `device_sync_recovery_requested`, `deviceSyncRecoveryRequested`, and
  `device_sync_recovery` semantics.
- The per-user Temporal workflow keeps only workflow-local compatibility needed
  for old recovery signals or activity results to replay/drain safely.
- The post-commit mailbox signal-failure contract is documented as the existing
  mailbox-wide best-effort handoff behavior, not a new device-sync recovery
  path.
- Focused tests prove legacy workflow compatibility and current contract
  rejection.

## Scope

- In scope:
  - `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
  - Temporal/shared/web tests that cover the reviewed behavior
  - Hosted runtime/Temporal docs that currently describe stale recovery behavior
- Out of scope:
  - Reintroducing web/shared recovery producers or demand flags
  - Adding a new mailbox lane, dirty sweeper, queue, cron, or scheduler
  - Capturing raw production Temporal histories or sensitive payload fixtures

## Constraints

- Technical constraints:
  - Temporal workflow state must stay pointer-only and deterministic.
  - Compatibility must stay workflow-local and legacy-facing.
  - No raw payloads, prompts, transcripts, provider data, secrets, or direct user
    identifiers in tests, docs, logs, or fixtures.
- Product/process constraints:
  - Preserve unrelated working-tree changes and active ledger rows.
  - Default to deletion and minimal compatibility code.

## Risks and mitigations

1. Risk: compatibility code becomes a live second recovery model.
   Mitigation: keep current shared/web parsers rejecting recovery semantics and
   document the workflow branch as old-history compatibility only.
2. Risk: old Temporal histories replay into a removed demand source.
   Mitigation: tolerate the old source only inside workflow clearing logic and
   add a focused state-machine regression.
3. Risk: Temporal worker deploys before the web/database side that writes
   durable `device-sync.wake` handoffs.
   Mitigation: document web/database-first deploy order; the worker legacy
   branch is replay compatibility, not live support for older web producers.

## Tasks

1. Add workflow-local legacy demand-source compatibility without changing
   public contracts.
2. Add focused tests for old recovery signals and old recovery demand results.
3. Update docs to remove live recovery-flag wording and clarify best-effort
   post-commit mailbox signal failures.
4. Run focused verification and required completion audits.
5. Commit and push the scoped PR update.

## Decisions

- Keep `device_sync_recovery_requested` accepted only by the Temporal workflow
  parser because old histories may contain that signal. It should not be
  exported by current shared contracts or produced by web.
- Deploy web/database changes before the Temporal worker deletion patch so old
  web producers do not rely on recovery-only signals after the worker stops
  forwarding them as live demand.

## Verification

- Commands to run:
- `pnpm --dir packages/hosted-orchestrator-temporal test -- hosted-user-runtime-workflow`
- `pnpm --dir packages/hosted-execution test -- hosted-orchestration-control`
- `pnpm --dir apps/web test -- device-sync-hosted-wake hosted-orchestration-demand`
- `pnpm test:diff packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts packages/hosted-execution/src/orchestration-control.ts packages/hosted-execution/src/parsers/orchestration-control.ts packages/hosted-execution/test/hosted-orchestration-control.test.ts apps/web/src/lib/device-sync/wake-service.ts apps/web/test/device-sync-hosted-wake.test.ts apps/web/test/hosted-orchestration-demand.test.ts agent-docs/references/hosted-runtime-protocol.md agent-docs/references/hosted-temporal-orchestration.md packages/hosted-orchestrator-temporal/README.md apps/web/README.md`
- Hosted Temporal replay proof: workflow compatibility uses old-history-safe
  parser acceptance plus a workflow-local legacy source branch; direct replay
  fixture remains unavailable unless a redacted/synthetic history is added.
- Expected outcomes:
- Focused tests pass.
- Diff-aware verification passes or any unrelated blocker is documented.
Completed: 2026-06-06
