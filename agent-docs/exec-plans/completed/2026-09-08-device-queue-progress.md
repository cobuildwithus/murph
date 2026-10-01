# Recover stalled device-sync wake and payload progress

Status: completed
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
- ReviewGPT Round 1 passed on a354504221e8a08e011f55284d87f2858646a2d8
  with verified model metadata and exact response identity. No findings met its
  qualifying bar. Parent review accepted the result without source remediation.
- Preserved the separately merged retained-history cadence fix from PR #3074.
  The base merge resolved additive test imports only. Combined runtime proof:
  431 tests passed; typecheck and complexity checks passed again.
- Implementation and diagnostic instrumentation are complete in PR #3075.
  Required final-head CI remains the merge gate. Production convergence is
  unverified: the independent runner rollout is still blocked. Neither the
  owner repair nor progress logging is proof that a live queue has drained.
  The recurring-pass diagnosis remains an operational follow-up requiring the
  deployed fingerprints and acknowledgement counts; no private queue state was
  changed or copied into this plan.
Completed: 2026-09-08
