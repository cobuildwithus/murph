# Browser Vault Retry Convergence

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make Browser Vault refresh retries converge without repeated no-op workspace
  checkpoints, silent mailbox-item loss, or work continuing after the runtime
  has yielded ownership.
- Double the bounded refresh deadline from 10 seconds to 20 seconds while
  preserving foreground conversation priority.

## Success criteria

- A resumed Browser Vault-only `recording` mailbox item is read-only until
  refresh produces a real outcome; a retryable outcome records one future retry
  and one checkpoint, while unrelated post-effect owners keep their fence.
- Every refresh outcome is classified exhaustively, including oversized
  replicas, missing workspaces, and unavailable Browser Vault publication.
- A timeout or foreground preemption cancels and joins owned replica work before
  the mailbox lane returns.
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
  retain the existing Browser Vault source/ref owner, use bounded future backoff,
  and add no duplicate state machine or compatibility layer.
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
3. Risk: treating an oversized replica as ordinary success silently loses the
   durable request.
   Mitigation: classify it as a retained retryable outcome with coarse metadata
   and future backoff.

## Tasks

1. Add red regressions for resumed recording retries, oversized outcomes,
   timeout cancellation, and the 20-second default.
2. Make resumed recording preparation read-only and persist retry outcomes only
   after an actual refresh result.
3. Exhaustively classify Browser Vault refresh results and join cancelled owned
   work before returning.
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

## Product UX

- Effort: Patch.
- Affected people: a member waiting for a foreground reply, a member whose
  background health replica needs refresh, and an operator monitoring durable
  runtime progress.
- Promise: foreground messaging remains responsive; background refresh either
  publishes or leaves one visible, future retry instead of checkpoint churn.
- Walkthrough proof: focused runtime tests cover foreground preemption, timeout,
  retry, oversized output, and success without exposing private replica data.

## Verification

- `hosted-runtime-workspace-entrypoint.test.ts`: 351 passed.
- Focused assistant-runtime Browser Vault and system-mailbox suites: 35 passed.
- Query Browser Vault, source, reader, and projection suites: 31 passed.
- Assistant-runtime and query package typechecks passed.
- Agent-docs drift passed; remediation diff/privacy inspection remains before
  the corrected-head commit.
- Exact pushed-head required GitHub Actions plus preliminary and final ReviewGPT.
