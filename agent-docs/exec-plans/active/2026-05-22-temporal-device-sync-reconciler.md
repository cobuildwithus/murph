# Temporal device-sync reconciler

Status: active
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

## Verification

- Commands to run:
  - Focused `apps/web` tests covering the new recovery sweep command/route.
  - Focused `packages/hosted-orchestrator-temporal` tests covering workflow and
    activity wiring.
  - `pnpm typecheck`
  - Required completion audits and diff/privacy checks.
