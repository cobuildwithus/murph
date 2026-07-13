# PR 511 ReviewGPT Round 17 Fix

## Goal

Resolve the accepted ReviewGPT round-seventeen finding for PR 511, prove an
old consumed replay row remains authoritative until its durable lane floor is
checkpointed, and rerun ReviewGPT on the exact pushed head until it reports no
further actionable findings.

## Finding To Prove

An accepted conversation row older than mailbox retention can gain
`consumedAt` before the workspace checkpoint retires its local pending input
and advances `conversationConsumedSeq`. The production projection and cleanup
currently treat `consumedAt` as an independent pruning boundary, so a
checkpoint conflict can restore the pending input after the exact durable row
has become unreadable or deletable and permit a blind resend.

## Constraints

- Use the existing durable conversation `consumed_seq` floor as the sole
  pruning boundary for accepted conversation rows.
- Keep every conversation row above that floor readable regardless of age or
  `consumedAt`; permit deletion only after the floor reaches it.
- Require an exact replay fetch to project its authorized conversation row.
- Preserve the Round 16 exact pending retirement and same-checkpoint floor
  advancement behavior.
- Add no tombstone, queue, ledger, repair worker, scheduler, or lifecycle
  owner.

## Working Set

- `apps/web/src/lib/hosted-mailbox/store.ts`
- `apps/web/app/api/internal/hosted-mailbox/fetch/route.ts`
- `apps/web/src/lib/hosted-retention/cleanup.ts`
- Focused mailbox projection, internal-route, retention, and hosted-runtime
  replay tests.
- Protocol documentation only where the pruning invariant needs clarification.

## Verification Plan

- Cover an old consumed conversation row above the durable floor in the
  production projection.
- Reject an exact replay projection that omits its authorized conversation
  row.
- Prove retention preserves an old consumed conversation row until the floor
  reaches it and may delete it afterward.
- Extend the checkpoint-conflict replay path with an old row and prove the
  restored retry remains provider-free, retires only the exact pending input,
  and checkpoints the exact floor.
- Run focused tests, relevant typechecks, required completion audits,
  repo-required verification, privacy/diff checks, scoped commit, push, CI,
  and another exact-head ReviewGPT pass.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
