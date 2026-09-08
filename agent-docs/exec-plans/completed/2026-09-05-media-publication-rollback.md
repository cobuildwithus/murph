# Preserve saved media when canonical persistence fails

The user resumed round five and authorized the accepted correction and landing.
Local and remote PR #2874 match ff7a4f332e1ec3df930339fea18cd9b1ba578058;
this session owns the branch and the completed review.

## Design and retrospective

Canonical publication runs while staged event changes can still roll back.
It must upload/register references additively, preserving previous catalogue
entries and objects. The existing snapshot owner reconciles committed holders
under the canonical write lock. Share candidate preparation between these two
callers without adding a service, queue, rollback manager, or policy owner.

Round four connected reference-only writes to a publisher whose destructive
snapshot semantics were inappropriate before acknowledgement. Previous proof
covered preservation but omitted replacement followed by persistence failure.
Preserve the original review baseline and counter; the next full review is six.

## Product UX and proof

Patch effort: a person whose saved attachment update fails must retain the
previously acknowledged attachment, including after cold restore. A successful
replacement must allow subsequent snapshot cleanup to reclaim the old object.
Existing image/video preservation and lazy retrieval behavior must remain.

- [x] Reproduce failed replacement through real canonical owners and receipt upload.
- [x] Split additive publication from committed-state reconciliation.
- [x] Prove rollback, cold retrieval, and cleanup after successful replacement.
- [x] Run focused tests, typecheck, guards; review and document the boundary.
- [ ] Commit, push, run exact-head review concurrently with CI, then land and retire.

Parent proof: the real addCapture/upsertEvent owners reproduced deletion after
receipt artifact upload failure while the event itself rolled back. The fix
preserves both catalogue entries and objects, restores the earlier metadata-only
snapshot with zero media reads, and retrieves the original bytes on demand.
A successful retry preserves the old entry until snapshot reconciliation, which
then deletes only the superseded object. Existing image/video preservation,
generic MIME recovery, and no-store controls continue to pass.

Artifact tests pass (18); receipt-entrypoint, invocation bridge, and idle
maintenance tests pass (127); runtime typecheck, complexity, docs drift,
workspace-boundary, and whitespace guards pass. The test array needed an explicit
inferred result type; no production typing exceptions were added. The previous
live-Codex journey remains applicable because this correction changes only the
storage publisher behind the unchanged consuming boundary.

Parent review confirms candidate preparation remains shared, canonical
publication performs one additive catalogue write, and snapshot reconciliation
retains its existing pruning semantics and canonical lock. Raw imported paths
are immutable. No new schema, dependency, policy, transport, lock, queue, or
rollback state. Product UX: Ready. Source delta is limited to the two existing
runtime media owners. Implementation/local review complete; exact-head CI and
user-resumed substantive review six still gate merge and worktree retirement.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
