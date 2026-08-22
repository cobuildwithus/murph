# Hosted Runtime Frontier Convergence

Status: active
Updated: 2026-08-21

## Goal

Make three proven hosted-runtime failure boundaries converge without weakening
foreground priority, mailbox ordering, replay safety, or Web-owned durable
truth:

1. a deterministic system notification must not permanently block eligible
   model-free system work behind it when assistant automation is policy-blocked;
2. a device-sync pass that starts must leave durable completion or exact
   interruption/retry evidence before ownership is released; and
3. a foreground-progress checkpoint with still-due device work must receive a
   bounded orchestration re-dispatch.

## Constraints

- Preserve FIFO completion and handled-through fences; do not delete, skip, or
  manually consume durable mailbox rows.
- Preserve foreground conversation and accepted assistant work ahead of device
  maintenance.
- Keep Web as the product/control truth owner, Temporal pointer-only, and
  Cloudflare as the execution adapter.
- Add no scheduler, queue, polling owner, broad resync, or persisted duplicate
  domain state.
- Keep production evidence aggregate and anonymous in repository artifacts.
- Maintain replay-safe Temporal deployment and migration requirements.

## Plan

1. Give ReviewGPT the aggregate production evidence, exact current source, the
   relevant merged and pending changes in both repositories, and require a
   scoped implementation patch with focused regressions.
2. Inspect the returned implementation against mailbox ownership, foreground
   priority, device-pass durability, Temporal replay, and deployment ordering.
3. Apply only evidence-backed changes; reject speculative fallbacks or manual
   data repair.
4. Run focused public and private runtime, mailbox, Cloudflare, Temporal, replay,
   and typecheck proof selected from the touched paths.
5. Commit and open the required PR or coordinated PRs, then run preliminary and
   final exact-head ReviewGPT gates with required CI.
6. Deploy in compatibility order and verify the corrected production frontiers
   converge before resolving the incident.

## Verification

- ReviewGPT reproduced both exact-delivery checkpoint gaps. The public runtime
  corrections are implemented with focused red-before/green-after regressions.
- Public package build, typecheck, and full runtime tests pass. Private Temporal
  PR #40 is merged with its replay-safe bounded redispatch proof.
- Pending final exact-head CI and ReviewGPT gate.
- Pending safe deployment and production convergence proof.

## Review Anomaly Retrospective

Substantive round 3 triggered the required direction-level retrospective. Both
accepted findings occurred where an exact notification crosses a checkpoint
while the runtime can restart or yield to foreground work.

The first-reviewed patch had 402 authored-source lines of churn. The current
patch has 658. Review remediation added 356 source lines of commit churn and
631 test lines of commit churn across two rounds:

- round 1 added stable-key outbox re-resolution, terminal/retry-state reading,
  mailbox wake projection, and restart recovery coverage;
- round 2 added token-checked release of a prepared pre-provider dispatch,
  a checkpoint for that release, and preemption/restore coverage.

The authority decision is explicit: the outbox intent wholly owns delivery
state, including due time, prepared/sending state, retry, ambiguity fences, and
terminal disposition. The system mailbox owns FIFO membership and
handled-through advancement only. Its `nextAttemptAt` is a derived scheduler
projection of the outbox wake, not an independent delivery decision; every
resume re-derives it from the stable outbox identity.

The provider-entry contract is:

1. Before provider entry, the outbox is pending/retryable. A prepared claim is
   durably checkpointed only to fence provider dispatch.
2. If foreground work wins before provider entry, the existing prepared token
   restores the captured prior outbox state and that release is checkpointed.
3. After provider entry, the existing outbox idempotency and non-idempotent
   ambiguity rules own recovery.
4. Retryable outbox state projects its wake to the recording mailbox item;
   terminal outbox state retires that item and advances FIFO handled-through.

Decision: continue the current joined PR without another architectural owner.
Deletion or reverting either correction would reopen a reproduced infinite
restart loop, duplicate-send window, or ten-minute unsent-confirmation delay.
Moving preparation after the foreground checkpoint would require a second
checkpoint on every normal send to preserve the pre-provider fence; the current
extra checkpoint occurs only on the rare preemption path. Splitting the already
complete device retry change would not reduce the exact-delivery lifecycle or
its deploy contract. The current direction adds no queue, scheduler, state
field, lifecycle enum, migration, compatibility path, or reconciliation loop;
it tightens existing mailbox, outbox, and checkpoint boundaries.
