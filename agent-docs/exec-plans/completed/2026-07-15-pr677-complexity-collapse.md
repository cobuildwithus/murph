# PR 677 Complexity Collapse

## Goal

Resolve the ReviewGPT round-two retrospective by deleting singleton repair-log
ownership and preserving foreground reply authority with one explicit rule:
unsafe receipt replay is rejected as a batch and the authoritative snapshot
remains canonical.

## Constraints

- Preserve the foreground reply authority invariant in
  `docs/contracts/00-invariants.md`.
- Never checkpoint partial receipt mutations or fabricate conflicting canonical
  state.
- Do not promise repairability for a receipt log that recovery rejected.
- Keep the failure diagnostic secret-safe and non-blocking.
- Add no repair collection, chain, queue, retry worker, service, or lifecycle.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/canonical-write-receipt-log.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `agent-docs/references/hosted-runtime-protocol.md`

## Verification Plan

- Reproduce two consecutive receipt-log failures separated by a successful
  foreground canonical write and crash boundary.
- Prove each failure restores the authoritative snapshot, clears the rejected
  active log, emits a diagnostic, and preserves foreground admission.
- Run focused tests, affected coverage/typechecks, the required coverage-write
  audit, `pnpm test:diff`, and ReviewGPT round three alongside CI.

## Retrospective Decision

- Original requirement: unsafe receipt recovery cannot corrupt canonical state
  or indefinitely block a durably accepted foreground message.
- First-reviewed head used catch-and-continue without atomic multi-action replay.
  Round-one remediation added snapshot rollback plus a singleton repair-log
  owner; that owner can overwrite an earlier unresolved reference after a
  second failure.
- Decision: delete repair-log ownership instead of adding a collection or chain.
  A failed active receipt log is explicitly rejected as unauthorized recovery
  input; the last-known-good snapshot is the sole canonical source. The runtime
  surfaces degraded diagnostics and continues, but it does not claim that the
  rejected batch remains automatically or manually repairable.

## Outcome

- Deleted the singleton repair status, fingerprint fields, retention wrapper,
  and web checkpoint allowlist additions.
- Failed replay still clears partial local effects and reloads the authoritative
  snapshot, then removes the rejected active receipt-log fields before
  foreground admission.
- A production-faithful regression proves two consecutive failures separated by
  a successful canonical-runtime checkpoint and container loss both preserve
  foreground canonical writing without creating repair ownership.
- The required coverage-write audit found no unresolved gap. Assistant-runtime
  coverage passed with 1,663 tests and 2 skips; the full 217-test entrypoint
  suite, affected typechecks, and `pnpm test:diff` passed.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
