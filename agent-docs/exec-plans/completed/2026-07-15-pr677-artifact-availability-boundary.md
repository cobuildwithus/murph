# PR 677 Artifact Availability Boundary

## Goal

Resolve the accepted ReviewGPT finding that a transient artifact-store read
failure could be misclassified as corrupt canonical receipt input and cause the
runtime to checkpoint away a valid durable receipt reference.

## Constraints

- Preserve the foreground reply authority invariant in
  `docs/contracts/00-invariants.md`.
- Reject deterministic missing, malformed, or conflicting receipt content and
  continue from the authoritative snapshot.
- On artifact read failure, clear partial local state, preserve the unchanged
  durable receipt reference, and fail the invocation so a later invocation can
  retry it.
- Add no repair owner, queue, service, retry state, or compatibility layer.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/canonical-write-receipt-log.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- focused protocol documentation only if the behavior needs clarification

## Verification Plan

- Add a regression proving a transient artifact read failure preserves the
  original durable receipt reference and admits no foreground mutation.
- Prove the next invocation replays the same canonical receipt and then accepts
  a fresh foreground canonical write.
- Run focused tests, affected coverage/typechecks, the required coverage-write
  audit, `pnpm test:diff`, CI, and ReviewGPT round four on the exact pushed head.

## Outcome

- Receipt artifact-store exceptions now clear partial local state and fail the
  invocation with the original error, leaving the durable receipt fingerprint
  unchanged for the next invocation.
- Missing, malformed, and conflicting receipt content still rejects the batch,
  restores the authoritative snapshot, and yields foreground authority without
  creating repair ownership.
- A table-driven runtime regression covers failures at the log, receipt, and
  second-payload reads; the last case proves an earlier partial action is
  removed before retry.
- The required coverage-write audit found no unresolved gap. Assistant-runtime
  coverage, the complete entrypoint suite, affected typechecks, and
  `pnpm test:diff` passed on the exact final diff.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
