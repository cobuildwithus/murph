# Repair hosted usage reset completion semantics

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make the `/ops/usage` reset complete the real recovery path: select the
  canonical allowance period, safely replenish it, wake already-accepted work,
  and allow one fresh quota notice after the replenished allowance is spent.

## Success criteria

- The dashboard projects access and the exact current period through the
  existing hosted allowance owner, including Family, trial, direct-billing,
  thread-container, overlapping-period, and no-persisted-row cases.
- Reset rejects a submitted period that is no longer canonical after locking
  the member and preserves every noncanonical or historical period.
- A committed reset signals the existing hosted runtime recheck; signal failure
  is reported as a committed, retryable partial outcome without replaying spend
  or losing the confirmation target.
- Releasing the current logical notice claim permits one fresh durable delivery
  attempt and fresh Linq provider idempotency identity while preserving old
  delivery history and ordinary same-attempt retry idempotency.
- Focused production-path regressions, required audits, canonical verification,
  CI, and ReviewGPT correction verification pass on the final pushed head.

## Constraints

- Do not add schema, reset ledgers, queues, schedulers, lifecycle enums, or a
  second allowance/runtime/delivery owner.
- Preserve immutable usage, purchased credits and ledger version, mailbox work,
  noncanonical usage periods, and delivery history.
- Keep logical notice identity stable for the active capacity epoch; make only
  the durable attempt row and external provider effect identity fresh after an
  operator explicitly releases the prior claim.
- Keep message-volume reporting on the disclosed retained mailbox source.

## Tasks

1. Add failing coverage for canonical period selection/rejection, reset wake
   completion and retry, and same-epoch notice delivery after reset.
2. Reuse the existing canonical gate per member inside one read transaction,
   batch-load only exact period metadata, and consume it from the ops dashboard.
3. Re-resolve the canonical gate in the reset transaction and signal the
   existing runtime after commit with a truthful partial response on failure.
4. Give claimed delivery attempts fresh durable IDs and use the usage-notice
   attempt ID as Linq's provider idempotency identity.
5. Run required verification, update the PR intent/change shape, commit, push,
   and complete ReviewGPT round 2.

## ReviewGPT round 1 evidence

- Accepted: clearing usage state without `runtime_recheck_requested` leaves
  already-accepted mailbox work asleep on its previous period-end timer.
- Accepted: nulling the reusable lookup key while retaining the deterministic
  delivery primary key makes the next same-epoch claim collide; reusing the raw
  logical key also lets Linq deduplicate the genuinely new attempt.
- Accepted: selecting the newest date-active persisted row disagrees with the
  canonical allowance owner when no row exists, access is inactive, plan facts
  changed, or Family and calendar-fallback periods overlap.

## Remediation-growth retrospective

- Trigger: the first set-based implementation added 617 production-source
  lines and exceeded both the 500-line and 25-percent remediation thresholds.
- The growth came almost entirely from duplicating the allowance owner's
  direct/Family/thread access loading and projection shapes for a bulk ops
  query. Although set-based, that shape created a second policy surface and was
  larger than the feature needs.
- Decision: delete the custom bulk policy. Resolve every row through the
  existing canonical `readHostedAiUsageGate` inside one read transaction, then
  batch-load only the exact persisted period metadata needed by the ops view.
  The ops page is allowlisted and low-frequency; one transaction with canonical
  per-member reads is preferable to hundreds of lines of duplicated policy.
- Continue the same PR because the other two corrections reuse existing runtime
  and delivery owners and add no new durable concepts. Re-measure source shape
  before the correction-verification round.
- Final re-measurement after deleting the duplicated policy: production source
  is +391/-121 lines relative to the first reviewed head. The remaining growth
  is the canonical projection, explicit wake-only partial retry, fresh delivery
  attempt identity, and operator UX; no second policy owner or durable reset
  state remains.
Completed: 2026-07-22
