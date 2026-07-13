# PR 572 round 6 remediation

Status: completed
Created: 2026-07-12

## Goal

Resolve the three accepted High findings from the final exact-head audit without
adding a second ordering owner: keep predeploy schema expansion compatible,
bind conversational mutations to one immutable runtime-owned input sequence,
and keep ordering metadata out of the strict user-preferences document.

## Scope

- Move the rejecting preference-sequence check from predeploy SQL to the
  post-convergence contract-migration path and teach the predeploy guard to
  reject validating check constraints.
- Serialize hosted conversational input processing to one accepted causal
  anchor per provider turn and defer later inputs to the next turn.
- Resolve the active turn's immutable sequence through the existing authenticated
  CLI runtime bridge; delete the model-writable numeric transport file.
- Store per-field applied watermarks in a separately versioned companion record
  staged in the same canonical write batch as the preferences mutation.
- Add the narrow reader/writer feature gate and durable two-phase rollout and
  rollback contract required for deploy compatibility.

## Constraints

- Preserve ordinary conversation, current-inbound processing, sparse Settings
  updates, canonical preference ownership, stale field no-op, fresh siblings,
  mailbox terminal handling, and crash/replay idempotence.
- Add no wall-clock ordering, second sequence allocator, receipt cache, queue
  manager, or unbounded lifecycle state.
- Keep the PR draft until green CI and a new substantive clean exact-head audit
  cover the corrected pushed head.

## Verification

- Focused migration/guard, CLI bridge, input serialization, preference owner,
  CLI command, and rollback compatibility tests.
- Owner typechecks, docs drift, diff check, scoped privacy scan, and diff-aware
  verification for the complete correction path.
Updated: 2026-07-13
Completed: 2026-07-13
