# Retained device-wake ownership

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Let scheduled device-sync recovery recognize a payload-retired wake for the
  entire lifetime of its exact runtime-owned continuation, without weakening
  the ordinary mailbox frontier.

## Success criteria

- Ownership begins at the existing post-checkpoint retention transfer, remains
  stable through every current pending/sending/recording retry transition, and
  ends through the existing item-removal path.
- Runtime checkpoints preserve the first ordinary blocking sequence and
  separately report every valid device-sync continuation owner.
- Web accepts a structurally exact scheduled-v3 duplicate only when it is the
  exact first unhandled item or an exact continuation owner already behind the
  handled frontier, with a covering imported watermark.
- Missing, completed, different, malformed, never-imported, payload-bearing,
  duplicate, or over-cap ownership fails closed.
- Focused runtime and real-PostgreSQL tests reproduce the composed lifecycle and
  pass, followed by package typechecks and required exact-head PR gates.

## Architecture and ownership

- Runtime remains the sole continuation owner. The existing versioned local
  system-mailbox item gains one optional literal-true lineage marker, assigned
  only by the existing post-checkpoint retention transition.
- Existing item-copying transitions preserve the marker through pending,
  sending, recording, retryable recording, and preemption. Existing completion
  removes the item and therefore its ownership; there is no separate cleanup.
- Restore promotes only the exact legacy pending retained-job shape to the
  marker, preserving owners created before rollout without keeping a second
  status-derived projection path.
- Checkpoint projection derives both views from that one mailbox state: marked
  valid continuations do not pin the ordinary frontier, while all other items do.
- Projection is all-or-nothing, sorted, limited to one owner per connection, and
  capped by the existing 100-connection complete-snapshot hydration authority.
  Any invalid, duplicate, impossible, or excess owner makes every marked item an
  ordinary blocker and publishes an empty continuation set.
- Web remains the mailbox and schedule-admission owner. It consumes only the
  exact checkpoint sequences and never infers ownership from the handled
  watermark.
- No canonical table, queue, scheduler, repair job, service, or second retry
  state machine is added.

## Evidence

- Production-safe aggregates showed payload-retired scheduled-v3 rows covered
  by imported and handled watermarks while the checkpoint's first-pending
  sequence had advanced, producing deterministic dedupe conflicts.
- The first candidate overloaded one global first-pending scalar. Review found
  that one retained connection could mask another connection's valid blocker.
- The second candidate separated pending retained retries, but review found that
  the same owner disappeared from that status-derived set after entering durable
  recording. This plan accepts that finding and models ownership as lineage
  across the complete existing item lifecycle instead of as a transient status.

## Risks and mitigations

1. Risk: Web could accept a completed or unrelated retired row.
   Mitigation: require exact first-unhandled equality or exact continuation
   membership, imported/high-water bounds, scheduled-v3 identity, and complete
   payload-retirement shape. Completion removes the owning item and projection.
2. Risk: corrupt continuation metadata could advance the ordinary frontier.
   Mitigation: validate route, wake, event/dedupe identity, connection, item,
   sequence, imported bound, uniqueness, and cardinality before excluding any
   marked item from the frontier; otherwise fail the whole projection closed.
3. Risk: mixed runtime/Web versions could preserve a stale owner list.
   Mitigation: corrected runtimes overwrite the list on every checkpoint;
   deployment order remains runtime-and-drain before Web, with Web rolled back
   first if rollback is required.

## Tasks

1. Completed: reproduced the production ownership mismatch and proved the
   global-first-pending masking failure.
2. Completed: accepted ReviewGPT's lifecycle finding and replaced the
   status-derived retry list with one durable marker on the existing mailbox
   item.
3. Completed: added lifecycle, transition, invalid-cardinality, parser-bound,
   legacy-restore, multi-connection, completion, and Web PostgreSQL regressions.
4. Completed: updated the reliability, protocol, index, testing, and existing
   changelog contracts for the lifecycle-complete design.
5. Completed: reran focused and package verification, the isolated PostgreSQL
   proof, documentation checks, and the complexity ratchet.
6. Remaining: commit and push the exact candidate, run ReviewGPT on the new head
   concurrently with CI, address any findings, archive this plan, verify the
   current-base merge tree, and merge. Deployment is a separate authorization.

## Product UX

- Effort: Patch.
- Outcome: an existing connected device resumes its already-owned continuation
  instead of a settings request failing because recovery rejected the same
  durable wake.
- Recovery remains bounded and invisible; the fix creates no new provider
  request owner or user-facing workflow.

## Product UX walkthrough

- Person and path: an existing member saves device settings while scheduled
  recovery encounters a payload-retired wake whose runtime continuation is
  pending, recording progress, or retrying that recording.
- Expected experience: the exact duplicate is treated as already accepted, the
  sweep does not convert it into a request failure, and the existing continuation
  remains responsible for completion.
- Failure and recovery: missing or inconsistent ownership fails closed; no
  provider work is recreated and no alternate scheduler is introduced.
- Result: local tests pass for two exact owners, another connection's blocker,
  legacy restore, the pending-to-recording-to-completion lifecycle, and
  whole-projection failure for ambiguity or overflow. Exact-head gates remain
  pending.

## Changelog

- Reused the existing 2026-09-03 connected-health recovery item because this
  correction completes the same member outcome. Added PR 2801 as a contributing
  source without duplicating the public claim or creating a second entry.

## Verification

- Passed: hosted-execution parser suite (36 tests).
- Passed: assistant-runtime mailbox state, checkpoint, and lifecycle suites (104
  tests), including legacy-owner promotion.
- Passed: assistant-runtime restore, scheduling, system-mailbox, and preemption
  entrypoint suites (147 tests).
- Passed: focused Web wake, due-reconcile, and recovery slice (206 tests).
- Passed: isolated migrated PostgreSQL recovery suite (20 tests).
- Passed: hosted-execution, assistant-runtime, and Web typechecks.
- Passed: changelog archive proof (9 tests) for the reused item.
- Passed: documentation drift/gardening, complexity ratchet, privacy scan, and
  diff check.
- Remaining: exact pushed-head ReviewGPT and CI gates.
