# Publish receipt recovery in one checkpoint and read accepted state from one owner

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and ownership

Restored-receipt recovery publishes recovered files, the genuine wake and cleared
receipt-log status in one workspace CAS. The publication state in
`createHostedWorkspacePublicationState` is the only owner of accepted workspace
facts; request builders and outer readers read it instead of a mutable copy.

## Scope and decisions

Delete the temporary mailbox wake, new recovery-marker writes, retain-log mode,
the reset CAS and accepted-field copying into caller metadata. Keep historical
marker readers, exported reserved keys, old-reader receipt barriers, invocation
identity, constructor fallback, explicit-null semantics, the staged status
overlay and the exported metadata types. No Web, adapter, schema or wire change.

The recovery CAS carries the published wake unchanged rather than re-running the
status wake resolver. Every earlier CAS resolved its wake from that durable state,
and the following pass recomputes it.

Web has no wake-dependent acceptance gate. `foreground_pending` left Web on
2026-07-09 and `conversationInputAhead` is a read-only response observation. The
recovery site ignores it, matching the old flow, which suppressed the observation.

The plain request builder keeps its existing wire shape: it still omits retention
and ignores a request version override. It has no production caller.

## Proof and progress

- Red runs on the old source failed 13 tests: the extra recovery CAS, the temporary
  wake, frozen-metadata writes and mixed snapshot defaults.
- Entrypoint proofs use real receipt replay and snapshots: pending conversation
  input, a retained marker with saved and null wakes, snapshot failure, CAS
  rejection and lost acknowledgement, each followed by a second invocation.
- Builder proofs cover both builders: sequential, duplicate, older and rejected
  responses, explicit and accepted null, frozen metadata, staged status and a
  status checkpoint accepted while a snapshot is held open.
- A real-PostgreSQL proof accepts the recovery request shape, with a genuine
  assistant wake and a pending conversation row, on the current Web CAS.

## Verification

Results and exit codes are recorded in the PR evidence for the reviewed head.
Completed: 2026-11-06
