# Attribute reply persistence and channel barrier timing

Status: active
Created: 2026-10-28
Updated: 2026-10-28

## Goal and evidence

Existing timing separates completed provider work from artifact persistence,
outbox queueing, post-queue work and a member-channel delivery barrier, but
cannot identify the slow child operation. Add bounded numeric attribution to
the existing buffered telemetry owners. This is a diagnostic, not a speedup.
Private occurrence evidence stays outside the repository; tests use synthetic
ports and state only.

## Scope and invariants

- Extend assistant-engine turn finalization/outbox and hosted runtime barrier
  timing at their current owners; no generic profiler or persistent store.
- Keep provider/queue/send anchors, alert thresholds, configured pauses and
  typing order unchanged. Preserve authority, cancellation, locks, writes,
  retries, delivery order and acknowledgement behavior.
- No new awaited I/O, network request or synchronous telemetry flush. Fixed
  numeric fields only, no raw payloads, errors, paths or new identifiers.
- No historical repair, replay, runtime wake, model call, billing/access change
  or customer-visible diagnostic probe.

## Design and rollout

Use optional narrow timing observers on existing persistence calls and fixed
child timings in the existing dispatch context. Existing pass buffers own
emission. Missing optional values mean unmeasured/skipped, not zero.
Two fixed post-queue stages preserve the existing reply-dispatched anchor.
Old producers remain readable. Publish compatible readers before producers;
coordinate the device lane's prerequisite and protected release owner. No
rollback or protected inspection is included in this authorization.

## Tasks

1. Reconcile current owners and fresh guarded checkout (done).
2. Implement bounded child timing and parser allowlists.
3. Prove attribution and unchanged semantics with synthetic controlled waits,
   errors, queue-only sends, cancellation and old/new telemetry shapes.
4. Run focused tests/typechecks, candidate review and complexity check.
5. Independent non-Claude review and exact-head CI, then coordinated merge and
   consumer-first release. Observe natural samples only.

## Verification

Focused assistant-engine persistence/outbox/final-response tests and runtime
barrier/parser tests, relevant package typechecks/builds for public exports.
No live assistant journey is required: model behavior, prompt/context and
product effects are unchanged. Required CI owns broad verification.

## Coordination and limits

Typing owner reports no overlap. Device owner reader-first release prerequisite
is pending reconciliation. No release slot claimed. Formal PR approval submission
requires specific action-time user confirmation. Independent review is allowed
only through the established non-Claude route; no Claude.

## Candidate proof

- Engine delivery/outbox/auto-reply event suites: 322 passing tests. Real-store
  finalizer and outbox attribution suites: 145 passing tests (outbox overlaps).
  Existing local failure, final-response anchor and resume-state suites pass.
- Runtime parser, foreground barrier, delivery and callback suites: 515 passing
  tests; the final scoped-clock foreground suite rerun passes all 96 tests.
- Both affected package typechecks and the runtime public package build pass.
- Complexity guard passes: total existing debt does not increase; local-service
  debt decreases by one by deriving the existing delivery intent identity once.
- Candidate review: diagnostics stay numeric, fixed-key, buffered and fail-open
  only for observers. Durable errors still propagate; observer errors cannot
  change writes or outbox dedupe. No new awaited operations or authority path.
  Existing large owner functions remain; extracting a new profiler would add
  machinery without reducing this bounded attribution change.
- Changelog not applicable: internal diagnostics only, no member-visible
  behavior or measured latency improvement. Independent review, exact-head CI
  and coordinated production publication remain pending.
