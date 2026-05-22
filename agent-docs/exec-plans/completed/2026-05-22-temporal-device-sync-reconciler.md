# Temporal device-sync reconciler

Status: completed
Created: 2026-05-22
Updated: 2026-05-22

## Goal

- Move device-sync recovery cadence ownership toward Temporal by adding a
  global Temporal reconciler workflow/activity that invokes a signed web-owned
  recovery sweep, while leaving the existing Vercel cron enabled as a temporary
  migration safety net.

## Success criteria

- Temporal has a short-lived global `hostedDeviceSyncReconcilerWorkflow` that
  runs one bounded recovery sweep and exits.
- The Temporal activity calls an authenticated internal web command that keeps
  canonical device-sync facts, claim/idempotency behavior, mailbox append, and
  recovery signaling in `apps/web`.
- The existing Vercel cron remains available during migration and reuses the
  same recovery sweep implementation where practical.
- Per-user workflows remain execution loops and do not gain global device-sync
  scans or per-user polling timers.
- Tests cover the signed web command and Temporal workflow/activity wiring.
- Durable docs describe the temporary dual-run migration and final ownership
  split.

## Scope

- In scope:
  - Device-sync recovery sweep command surface in `apps/web`.
  - Temporal reconciler workflow/activity and schedule wiring.
  - Focused web and Temporal tests for retry/idempotent command wiring.
  - Durable architecture and package documentation updates.
- Out of scope:
  - Removing the Vercel cron route or `vercel.json` schedule.
  - Changing provider ingress dirty-state semantics.
  - Switching dirty recovery fanout from per-connection to per-user nudges.
  - Adding global device-sync scans to `hostedUserRuntimeWorkflow` or
    `readRuntimeDemand`.

## Constraints

- Technical constraints:
  - Keep Temporal history pointer-only: no provider payloads, tokens, dirty
    resource bodies, raw account state, prompts, transcripts, or local paths.
  - Do not make provider webhook acceptance depend on Temporal availability.
  - Reuse existing idempotent web sweepers and mailbox append duplicate
    handling for the migration path.
  - Avoid command-order changes in the long-lived per-user workflow.
  - Preserve unrelated dirty worktree edits.
- Product/process constraints:
  - Follow high-risk repo workflow: plan, ledger, focused verification,
    completion audits, and scoped commit if safe.

## Risks and mitigations

1. Risk: Temporal retries could create duplicate effective work.
   Mitigation: Keep retries pointed at the existing web sweepers whose event ids,
   dirty revisions, and due-reconcile signals already dedupe appends; add
   focused duplicate-call tests around the command seam.
2. Risk: The migration could create two schedulers long term.
   Mitigation: Document cron as a temporary safety net and make the Temporal
   Schedule the intended owner of cadence once enabled.
3. Risk: A global workflow could leak canonical state into history.
   Mitigation: Activity result contains only counts/status, and web remains the
   only owner of Postgres device-sync facts.

## Tasks

1. Register plan/ledger and trace current cron/auth/Temporal worker patterns.
2. Add a shared web recovery sweep command and signed internal endpoint.
3. Add the Temporal recovery sweep activity and short-lived reconciler workflow.
4. Add schedule registration or explicit schedule wiring behind a narrow feature
   flag.
5. Add focused tests and update durable docs.
6. Run verification, completion audits, inspect diff for privacy leakage, and
   commit via `scripts/finish-task` if safe.

## Decisions

- Treat the current cron as a temporary migration safety net, not the final
  scheduler.
- Keep canonical dirty and due-reconcile facts in `apps/web` Postgres.
- Keep per-user Temporal workflows focused on user runtime execution after
  mailbox/signal nudges.
- Register the Temporal Schedule through an explicit idempotent ensure command
  gated by `HOSTED_DEVICE_SYNC_RECONCILER_SCHEDULE_ENABLED` instead of making
  worker startup mutate Temporal Schedule state.

## Verification

- Commands to run:
  - Focused `apps/web` tests covering the new recovery sweep command/route.
  - Focused `packages/hosted-orchestrator-temporal` tests covering workflow and
    activity wiring.
  - `pnpm typecheck`
  - Required completion audits and diff/privacy checks.
- Results so far:
  - PASS: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-device-sync-dirty-sweeper-route.test.ts apps/web/test/hosted-device-sync-recovery-sweep-route.test.ts apps/web/test/hosted-device-sync-dirty-sweeper.test.ts apps/web/test/hosted-device-sync-due-reconcile-sweeper.test.ts`
  - PASS: `pnpm --dir packages/hosted-orchestrator-temporal exec vitest run --config vitest.config.ts --no-coverage test/hosted-device-sync-recovery-sweep-activity.test.ts test/hosted-device-sync-reconciler.test.ts test/worker.test.ts test/workflow-contracts.test.ts`
  - PASS: `pnpm --dir packages/hosted-execution test`
  - PASS: `pnpm --dir packages/hosted-orchestrator-temporal typecheck`
  - PASS: `pnpm --dir packages/hosted-orchestrator-temporal test:coverage`
  - PASS: `pnpm --dir apps/web typecheck`
  - PASS: `pnpm --filter @murphai/hosted-execution build`
  - PASS: `pnpm test:smoke`
  - PASS: `pnpm test:diff apps/web/app/api/internal/device-sync/dirty-sweeper/cron/route.ts apps/web/app/api/internal/device-sync/recovery-sweep/route.ts apps/web/src/lib/device-sync/recovery-sweeper.ts apps/web/test/hosted-device-sync-dirty-sweeper-route.test.ts apps/web/test/hosted-device-sync-recovery-sweep-route.test.ts packages/hosted-execution/src/routes.ts packages/hosted-execution/test/hosted-execution.test.ts packages/hosted-orchestrator-temporal/src/activities/http-client.ts packages/hosted-orchestrator-temporal/src/activities/run-device-sync-recovery-sweep.ts packages/hosted-orchestrator-temporal/src/client/device-sync-reconciler-schedule.ts packages/hosted-orchestrator-temporal/src/workflows/hosted-device-sync-reconciler.ts packages/hosted-orchestrator-temporal/test/hosted-device-sync-recovery-sweep-activity.test.ts packages/hosted-orchestrator-temporal/test/hosted-device-sync-reconciler.test.ts`
  - PASS: `git diff --check`
  - PASS: `security-privacy-review` audit found no findings.
  - PASS: `simplify` audit findings were applied.
  - PASS: `coverage-write` audit requested no test changes.
  - BLOCKED: root `pnpm typecheck` fails in unrelated dirty wearable receipt
    test work under `packages/core/test/wearable-receipts.test.ts`.
Completed: 2026-05-22
