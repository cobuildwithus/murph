# Hosted Runtime Frontier Convergence

Status: active
Updated: 2026-08-22

## Goal

Make three proven hosted-runtime failure boundaries converge without weakening
foreground priority, mailbox ordering, replay safety, or Web-owned durable
truth:

1. a deterministic system notification must not permanently block eligible
   model-free system work behind it when assistant automation is policy-blocked;
2. a device-sync pass that starts must leave durable completion or exact
   interruption/retry evidence before ownership is released; and
3. a foreground-progress checkpoint with still-due device work must receive a
   bounded orchestration re-dispatch;
4. a runtime whose inactive system frontier was retired must retain a durable,
   exact recovery path when billing or Family access becomes active again; and
5. an interactive Environment interview must not wait behind background
   device-sync recovery load on the shared Temporal Task Queue.

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
7. Retire stale Temporal system-pointer projections when inactive access admits
   no mailbox work, while preserving the independent inbox-media retention wake
   and durable Web-owned mailbox rows for later reactivation.
8. Commit one deterministic maintenance mailbox item with every proven
   inactive-to-active access restoration and delete the pointerless Family and
   restoration-specific billing retry paths it replaces.
9. Deploy a priority-aware private Temporal consumer, then expose the existing
   Environment-pending reconciliation fact from Web. Keep interactive work at
   high priority, ordinary work at the default, and the global device-sync
   sweep at low priority on the same Task Queue.

## Verification

- ReviewGPT reproduced both exact-delivery checkpoint gaps. The public runtime
  corrections are implemented with focused red-before/green-after regressions.
- Public package build, typecheck, and full runtime tests pass. Private Temporal
  PR #40 is merged with its replay-safe bounded redispatch proof.
- The deployed tolerant Temporal consumer can distinguish an omitted rollout
  field from an explicit no-work frontier. Residual production proof showed
  inactive workflows receiving the omitted form and repeatedly retrying their
  retained pointer projection even though Web admitted no mailbox work.
- Access-restoration remediation now uses the existing Web-owned mailbox as its
  sole durable handoff. The access transaction appends an exact deterministic
  `runtime.maintenance-requested` item, the normal pointer signal remains a
  best-effort fast path, and the existing bounded mailbox-handoff sweep owns a
  failed first signal. No queue, schema field, scheduler, polling owner, or
  compatibility path was added; obsolete pointerless Family and dispute retry
  plumbing was deleted.
- Focused public regression proof and Web typecheck pass. Exact-head CI and the
  next ReviewGPT gate remain pending.
- Pending Web deployment and aggregate production convergence proof with the
  Temporal workers and device-sync schedule left active.
- Pending consumer-first priority rollout: the priority-aware private Temporal
  consumer deploys before Web emits the Environment-pending wire fact.

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

## Access-Restoration Review Retrospective

The next accepted review finding exposed the same requirement-level boundary:
explicit-null frontier retirement is safe only when every access restoration
commits restart-safe work before returning success. A one-shot payload-free
signal could be lost after Family invite acceptance or billing restoration,
leaving retained mailbox work with no durable retry owner.

The authority decision stays intentionally small. Web's existing mailbox is
the sole durable owner, so each proven inactive-to-active transition appends a
deterministic `runtime.maintenance-requested` item inside the access transaction.
Temporal receives only its exact pointer, and the existing bounded mailbox
handoff sweep recovers a missed signal. Stripe stores that pointer in its
existing receipt result. This replaces and deletes the pointerless Family
post-commit helper plus restoration-specific dispute reconstruction. It adds no
state field, queue, scheduler, roster receipt, polling loop, compatibility shim,
or new lifecycle owner.
