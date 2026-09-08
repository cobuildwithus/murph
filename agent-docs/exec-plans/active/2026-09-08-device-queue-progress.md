# Recover stalled device-sync wake and payload progress

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and invariants

Accepted wearable work must retain a runnable owner until checkpoint-safe
acknowledgement, and repeated bounded passes must advance durable progress.
Preserve foreground priority, exact payload acknowledgement, canonical health
writes, connection authority, bounded database work, and private-data boundaries.

Product UX effort: Patch. Replays cover silent background recovery, new ingress
during completion, cold restore after yield, and foreground preemption.

## Evidence and ownership

Two observed patterns require independent proof: a consumed wake with hosted
payloads pending, and recurring timed-out worker passes without payload drain.
Web owns dirty revisions/payloads and mailbox admission; runtime owns job
execution and checkpoint records. Inspect existing owners before adding state.
No production identities, payloads, or copied rows belong in this plan or tests.

## Work

1. Trace both patterns using bounded production metadata and current source;
   inspect overlapping PRs. Add synthetic failing composed reproductions.
2. Correct only proven causes at existing wake/admission/checkpoint owners.
   Add bounded counts/stages if existing logs cannot establish progress.
3. Test recovery and protected success/failure paths; run relevant typechecks,
   complexity/docs checks, parent review, changelog, and required PR review/CI.
4. Keep deployment coordination separate from diagnosis. Confirm rollout before
   claiming live recovery; do not mutate private vaults or queues directly.

## Failure and evolution

No new persisted owner or schema is planned. Failed checkpoint/acknowledgement
must retain accepted work and future retry. If evidence requires a protocol
change, document supported deployment skew before implementation.

## Progress

- Created isolated checkout on current main; no overlapping open sync fix.
- Recent merged ingress contention and callback fixes do not address runtime
  wake completion or repeated worker drain. Existing diagnostics PRs inspected.
- Reproduced owner removal when a clean-looking pass receives a still-dirty
  acknowledgement; both single and batch record forms failed before the fix.
  A fresh-runtime replay now processes the new exact payload and releases ownership.
- Reproduced the existing scheduled identity being reused after its owner was
  consumed. A real local PostgreSQL proof now selects a fresh recovery identity
  only with complete durable evidence that no owner remains.
- Runtime and foreground interaction proof: 325 tests passed. Runtime and
  hosted-execution typechecks passed; Web prepared typecheck passed. Complexity
  guard passes without increasing debt in changed files.
- Added private progress fingerprints and checkpoint decision counts. Repeated
  provider passes are observed, but current production telemetry cannot prove
  whether their cursors advance; live confirmation requires runner rollout.
- Web proof: 34 tests passed, including actual PostgreSQL recovery append,
  stable replay across unrelated checkpoints and dirty revisions, and exclusions
  for retained/pending owners and incomplete legacy projections.
- Parent candidate review: existing bounded selection and admission owners reused;
  no migration, provider data logging, foreground network call, or new queue.
- Remaining: exact-head PR review/CI, and post-deploy
  queue recovery/progress verification. The recurring-pass diagnosis stays open;
  logging is evidence collection, not a claimed fix for an unproven cause.
