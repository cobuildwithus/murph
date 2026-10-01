# Preserve reference-only media saves at canonical commit

The user resumed the accepted round-four finding and authorized a clean fix and
completion. Local and remote PR #2874 match e37c3b99aea0742a625da709d53fe1c5a9e3c5c5;
the completion child finished without edits and no longer owns a process.

## Design and retrospective

The canonical media hook currently gates on raw payloads, although an event
receipt can establish a durable media holder using only raw references. Route
those existing event payloads through the same publication owner and include
their affected media references in the same durable receipt using the existing
payload-free raw_upsert representation. Keep plain text writes on their fast
path. Reuse canonical event path and raw-reference helpers; do not add a new
service, queue, state owner, or parallel retention policy.

The review gap was caller coverage: earlier proof exercised new raw writes and
the retention owner separately, but omitted canonical reference-only callers.
This correction joins that existing caller to the existing persistence boundary.
The user explicitly resumed completion after round four; preserve all review
baselines and counters, finish parent proof and CI before continuation review.

## Product UX and proof

Patch effort: a person explicitly saving an existing image or video should keep
it after the transient deadline and after cold restore. Unreferenced media
should still expire. A save after terminal retirement must report unavailability
instead of acknowledging preservation. Channel presentation and authorization
do not change.

- [x] Reproduce reference-only writes through the real canonical event owner.
- [x] Persist preservation and replayable media metadata before acknowledgement.
- [x] Prove image/video recovery without downloads, expiry controls, and rejected
      preservation after retirement; run relevant tests and typechecks.
- [ ] Parent review, durable documentation, scoped commit, exact-head CI and
      routed continuation review; merge and retire only after resolved gates.


The four image/video before/after-retirement cases reproduced the missing record
call and false acknowledgement before the fix. After the correction, the real
canonical event owner emits the replayable lifetime update without raw payloads;
receipt-log restore from an earlier metadata-only snapshot restores the holder
and null expiry with zero media reads. Selected retrieval returns identical
bytes, unreferenced media still expires in the transport control, and terminal
retirement rejects the write before a receipt is acknowledged. The actual DO
preservation/expiry ordering is independently covered by its existing 19 focused
alarm tests. Artifact and receipt-entrypoint tests pass (36), runtime typecheck
passes, and complexity/docs/workspace-boundary guards pass.

Parent review: event identification and raw-reference extraction reuse public
core/contracts helpers; only supported raw inbox/capture references trigger
publication. The existing collector remains the lifetime policy owner, the
existing store registers retention, and the existing raw receipt representation
carries replay metadata. Explicit file actions retain precedence. Plain event
writes return the original persistence input without creating media state. No
schema, dependency, transport or assistant prompt/tool contract changes. The
existing real two-turn video proof remains applicable; this delta changes only
canonical persistence behind that consuming boundary.

Implementation and local review are complete. Exact-head CI and the user-resumed
continuation review remain required before merge and worktree retirement.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
