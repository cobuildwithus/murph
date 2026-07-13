# PR 511 ReviewGPT Round 18 Fix

## Goal

Resolve both accepted ReviewGPT round-eighteen findings for PR 511 without
adding a second replay owner, then rerun ReviewGPT on the exact pushed head
until it reports no further actionable findings.

## Findings To Prove

1. An old consumed conversation row above the durable conversation floor is
   selected by the mailbox projection, but inline projection and sidecar
   retrieval can still prune its payload by wall-clock age. A restored replay
   may then acknowledge content it never reconstructed.
2. An exact consumed replay above the restored import watermark rebuilds the
   deterministic input with a null reply target. If the original immutable
   event already exists, the upsert conflicts before the existing exact
   pending-retirement path can run.

## Constraints

- Use the same-user conversation `consumed_seq` floor as the sole payload
  pruning boundary for accepted conversation rows.
- Preserve the original immutable assistant input event identity during
  consumed replay.
- Suppress duplicate execution at the existing pending-index/effect owner.
- Preserve unrelated pending work, exact checkpoint advancement, provider-free
  retry, and fresh same-thread processing.
- Add no tombstone, queue, ledger, repair worker, scheduler, or lifecycle
  owner.

## Working Set

- `apps/web/src/lib/hosted-mailbox/store.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- Focused mailbox payload/projection and hosted-runtime replay tests.
- Protocol documentation only if the existing invariant needs clarification.

## Verification Plan

- Prove old consumed inline and sidecar payloads remain resolvable while their
  sequence is above the durable floor.
- Seed an original non-null-reply-target event plus exact and unrelated pending
  entries at import watermark `N-1`; prove exact consumed replay preserves the
  stored event, enqueues no duplicate, retires only the exact pending entry,
  remains provider-free across a checkpoint conflict, and checkpoints `N`.
- Prove cleanup may delete after the floor reaches `N`, then process fresh
  same-thread `N+1` exactly once.
- Run focused tests, relevant typechecks, required completion audits,
  repo-required verification, privacy/diff checks, scoped commit, push, CI,
  and another exact-head ReviewGPT pass.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
