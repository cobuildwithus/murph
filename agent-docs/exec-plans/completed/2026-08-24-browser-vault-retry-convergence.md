# Browser Vault Retry Convergence

Status: completed
Created: 2026-08-24
Updated: 2026-08-25

## Goal

- Make Browser Vault refresh work converge without repeated no-op workspace
  checkpoints, silent mailbox-item loss, or work continuing after the runtime
  has yielded ownership.
- Double the bounded refresh deadline from 10 seconds to 20 seconds while
  preserving foreground conversation priority.

## Success criteria

- A resumed Browser Vault-only `recording` mailbox item is read-only until
  refresh produces a real outcome; foreground preemption retains that item,
  while completed or failed attempts advance it without scheduling a no-progress
  retry. Unrelated post-effect owners keep their fence.
- Every refresh outcome is classified exhaustively, including oversized
  replicas, missing workspaces, and unavailable Browser Vault publication.
- A timeout or foreground preemption cancels and joins owned replica work before
  the mailbox lane returns.
- Replica construction reads one canonical source snapshot and derives metrics
  in memory without rebuilding or mutating the local SQLite query projection.
- Fresh mailbox work keeps its existing pre-effect durability fence, successful
  publication remains exactly-once, and foreground work remains higher priority.
- Focused tests, affected package typechecks, exact-head CI, preliminary
  specialist ReviewGPT, and final ReviewGPT pass.

## Scope

- In scope: the assistant-runtime Browser Vault refresh deadline, system-mailbox
  recording lifecycle, refresh-result classification, cooperative cancellation,
  focused tests, and matching durable runtime documentation.
- Out of scope: deleting retained health history, weakening replica completeness,
  changing shard or monolith compatibility, adding a scheduler/queue/worker,
  or redesigning Browser Vault storage.

## Constraints

- Technical constraints: keep the system mailbox as the sole durable work owner,
  retain the existing Browser Vault source/ref owner, rely on later Web freshness
  requests after terminal failures, and add no duplicate state machine or
  compatibility layer.
- Product/process constraints: foreground replies must preempt maintenance;
  production evidence remains aggregate and anonymous; the smallest maintainable
  correction wins over speculative optimization.

## Risks and mitigations

1. Risk: removing the repeated preparation write could weaken the pre-effect
   durability fence for fresh or unrelated recording work.
   Mitigation: skip that write only for already-durable Browser Vault control
   and no-record device-sync items; retain the existing checkpoint for fresh
   work and every recording item with post-checkpoint effects.
2. Risk: cancellation propagation could create broad API churn.
   Mitigation: thread the existing invocation abort signal only through the
   replica-build boundary and its bounded query phases; add no new executor.
3. Risk: retrying an unchanged oversized or generic failure indefinitely blocks
   the shared system-mailbox key without any possible progress.
   Mitigation: terminally record that attempt; a later browser freshness request
   can enqueue fresh work after canonical state or deployment behavior changes.

## Tasks

1. Add red regressions for an unchanged oversized outcome, stale-projection
   independence, real cancellation, and the 20-second default.
2. Make resumed recording preparation read-only and terminally record
   non-preemption outcomes without a future no-progress retry.
3. Build from one canonical source snapshot, derive metrics in memory,
   exhaustively classify refresh results, and join cancelled owned work before
   returning.
4. Run focused tests, typecheck, diff review, exact-head PR review gates, and CI.

## Decisions

- Reuse the existing mailbox item, retry timestamp, source hash, cancellation
  scope, and checkpoint callback. Add no scheduler, queue, supervisor, worker,
  persisted state field, or storage migration.
- Leave replica-retention and sharding policy unchanged. The incident evidence
  points to retained history and a retry-state defect, not safe evidence for
  deleting canonical data or adding another replica format.
- Keep read-only resume deliberately narrower than the shared `recording`
  lifecycle. Browser Vault control rows and no-record device-sync rows qualify;
  notification delivery and every post-checkpoint effect owner retain their
  established checkpoint fence.
- Accept the preliminary specialist finding that eager owned-work construction
  and fail-fast query fan-out could leave a production query child running after
  timeout. Start owned work lazily, pass the existing abort signal through the
  source/read/metric query boundaries, and settle every started local child;
  add no executor or duplicate cancellation owner.
- Accept the final-round finding that the first remediation still crossed stale
  SQLite and synchronous history-sized work while indefinitely retrying
  unchanged failures. Remove Browser Vault from the SQLite projection path,
  keep cancellation on the direct source/build tree with cooperative source and
  serialization checkpoints, and retain the mailbox item only for actual
  foreground/host preemption.

## Product UX

- Effort: Patch.
- Affected people: a member waiting for a foreground reply, a member whose
  background health replica needs refresh, and an operator monitoring durable
  runtime progress.
- Promise: foreground messaging remains responsive; background refresh either
  publishes, yields intact to foreground work, or finishes the current failed
  request so it cannot block later mailbox work.
- Walkthrough proof: focused runtime tests cover real canonical-source deadline
  and foreground-wake cancellation, a subsequent successful publish, terminal
  oversized output, and stale SQLite projection independence without exposing
  private replica data.
- Post-remediation review: Ready for exact-head review. Cancelled real source
  work settles before the lane returns, a fresh attempt publishes immediately,
  and an unchanged oversized payload advances instead of pinning the shared
  system-mailbox key.

## Verification

- Red regressions failed on stale SQLite rebuild and unchanged oversized retry
  before the correction.
- Query source, projection, reader, health, and Browser Vault suites: 44 passed.
- Assistant-runtime real-vault cancellation, Browser Vault, runtime-wake,
  terminal oversized, and terminal publish-conflict coverage: 19 passed.
- Assistant-runtime and query package typechecks passed after the correction;
  agent-docs drift passed.
- Diff/privacy inspection, exact-head CI, and final ReviewGPT remain before PR
  completion.
- Exact pushed-head required GitHub Actions plus preliminary and final ReviewGPT.
Completed: 2026-08-25
