# Stop production runtime wake churn

Status: active
Updated: 2026-08-18

## Goal

Stop production hosted-runtime invocations from repeatedly checkpointing and
reconciling unchanged due wakes while preserving prompt execution of genuine
assistant schedules, conversation work, and connected-health maintenance.

## Evidence

- A production five-minute window contained more than 24,000 Web invocations,
  dominated by hosted workspace, reconciliation, mailbox, runtime-log,
  checkpoint, and owner-release routes.
- Matching runtime evidence showed roughly 1,400 empty mailbox imports and
  idle-shutdown checkpoints per five minutes across a small due-workspace
  cohort, with almost no assistant or device work.
- The hot checkpoint shape retains a due wake and increments the workspace
  version. Errors remain near zero because each individual request succeeds.
- Static tracing reaches the `system_mailbox` processing path: a due assistant
  schedule can be handed back through an immediate recheck while the active
  background owner remains in that mode, producing another unchanged pass.

## Product UX patch

- Outcome: existing scheduled assistant and connected-health work completes
  without invisible no-op rechecks consuming capacity.
- Existing hosted member with a stale assistant wake: the real due schedule is
  serviced once or retired by its authoritative owner.
- Member sending fresh conversation input: foreground work keeps priority over
  background maintenance.
- Member with genuine future work: the exact future wake remains scheduled.

## Constraints

- Keep mailbox rows and workspace checkpoints as durable truth; a wake remains
  a droppable notification.
- Do not add a scheduler, queue, or second persisted state owner.
- Do not suppress or delay genuine reminders, replies, usage/access recovery,
  device sync, or privacy cleanup.
- Keep production evidence aggregate and free of direct identifiers.
- Avoid overlap with the open reminder-successor work; change only the owner of
  cross-mode wake convergence.

## Plan

1. Reproduce the unchanged cross-mode wake path on current `main` and send the
   aggregate evidence plus owning code to ReviewGPT for an independent patch.
2. Add a production-shape regression that fails before the fix and proves a
   default/assistant wake cannot remain trapped behind an active
   `system_mailbox` pass.
3. Implement the smallest correction at the existing mode-transition owner.
4. Run focused owner tests, typechecks, Product UX replay, specialist review,
   final ReviewGPT, and exact-head CI.
5. Merge and deploy in the documented safe order, then confirm both the due
   cohort and hosted invocation rate converge.

## Verification

- Focused assistant-runtime and/or Cloudflare mode-transition regression.
- A genuine system-mailbox recheck still coalesces without restarting work.
- A genuine future assistant wake remains armed.
- Relevant package typechecks and diff hygiene pass locally.
- Required GitHub checks and ReviewGPT gates pass on the exact PR head.
- Post-deploy aggregates show the empty-import/checkpoint loop collapsing and
  due workspaces no longer advancing versions without useful work.
