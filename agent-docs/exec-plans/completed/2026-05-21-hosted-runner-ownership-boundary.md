# Hosted runner ownership boundary simplification

Status: completed
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Make the hosted runtime ownership model simple and durable: Temporal starts or
  wakes work, Cloudflare owns the active write-fenced lease, the hot container
  owns dirty local runtime state, and `idle_shutdown` remains the durable commit
  path when the owned run ends.

## Success criteria

- Accepted runtime processing no longer makes Temporal poll durable mailbox lag
  in a short startup loop while Cloudflare still owns an active write fence.
- New signals during an owned run still interrupt Temporal and wake the active
  runner through Cloudflare.
- Durable mailbox/control demand is used for start or recovery only when no
  active runner owns execution.
- Cross-lease dirty warm restore is removed or made clean-only so a new lease
  restores from durable workspace truth rather than stale local tmp state.
- Focused tests prove the ownership wait and dirty warm-restore invariants.

## Scope

- In scope:
  - `apps/cloudflare/src/user-runner.ts`
  - `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
  - `packages/hosted-orchestrator-temporal/src/activities/**`
  - `packages/hosted-orchestrator-temporal/test/**`
  - `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
  - `packages/assistant-runtime/test/**`
  - Durable hosted runtime/Temporal architecture docs.
- Out of scope:
  - Checkpoint-after-reply or per-mailbox mini-checkpoints.
  - Web demand polling Cloudflare failure state.
  - New durable schedulers, ledgers, or queue-history abstractions.
  - Broad hosted-runner compatibility cleanup owned by existing active rows.

## Constraints

- Keep Temporal workflow state pointer-only and free of payloads, prompts,
  transcripts, provider responses, local paths, or direct identifiers.
- Preserve unrelated dirty worktree edits and active rows.
- Any awaited Temporal command-order change requires replay compatibility
  evidence or patching.
- Do not add new persisted state.

## Risks and mitigations

1. Risk: Existing Workflow histories hit a different awaited command sequence.
   Mitigation: keep the accepted-processing path on the existing
   signal-aware wait shape when possible; if a new Activity is unavoidable, add
   Temporal patching or replay evidence.
2. Risk: Active runner failures could hide durable mailbox demand.
   Mitigation: Cloudflare write fence expiry/clear remains the recovery boundary;
   once ownership ends, Temporal returns to durable web demand.
3. Risk: Removing dirty warm restore slows local/dev warm paths.
   Mitigation: prefer correctness and a single durable truth over cross-lease
   local cache reuse; keep any future warm optimization clean-only.

## Tasks

1. Inspect current workflow, Cloudflare runner, restore, and tests.
2. Change Cloudflare accepted rechecks to owner-watchdog timing.
3. Change Temporal accepted-processing wait so durable demand is only re-read
   after ownership ends or a new signal requires a wake.
4. Remove or cleanly disable cross-lease dirty warm restore.
5. Update durable docs and focused tests.
6. Run focused verification, required audits, and close with a scoped commit if
   unrelated dirty work does not block it.

## Verification

- Passed:
  - `pnpm exec vitest run apps/cloudflare/test/user-runner-alarm.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
  - `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run test/hosted-user-runtime-workflow.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-restore-codex-continuity.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --config vitest.config.ts --no-coverage`
  - `git diff --check -- packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts ARCHITECTURE.md agent-docs/references/hosted-temporal-orchestration.md agent-docs/references/hosted-runtime-protocol.md`
Completed: 2026-05-21
