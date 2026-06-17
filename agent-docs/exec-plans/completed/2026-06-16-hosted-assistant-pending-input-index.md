# Hosted assistant pending input index implementation

Status: completed
Created: 2026-06-16
Updated: 2026-06-16

## Goal

- Land the reviewed hosted assistant foreground input simplification: remove
  broad hosted foreground provider-start history scans while preserving the
  invariant that every staged hosted conversation `AssistantInputEvent` remains
  eligible until complete auto-reply terminal evidence exists.

## Success criteria

- Hosted conversation staging enqueues the staged `inputId` before mailbox
  import can advance the lane watermark.
- Hosted foreground assistant automation direct-reads selected IDs and never
  calls the store-backed `listAssistantInputEvents` scan.
- Fresh foreground inputs include older pending same-conversation IDs, exclude
  unrelated old pending IDs, and leave unrelated pending IDs for background
  catch-up.
- Pending wake and mailbox consume-ack gating use the hosted pending input ID
  index instead of scanner-backed pending discovery.
- The preferred/replay foreground concepts and scan-limit plumbing are deleted.
- Focused tests cover the pending index, terminal compaction, staging enqueue,
  direct source filters, foreground/background selection, pending wake, and
  consume-ack behavior.

## Scope

- In scope: `packages/assistant-runtime` hosted-runtime admission/automation
  code, the shared assistant auto-reply terminal-evidence predicate in
  `packages/assistant-engine`, and matching focused tests.
- Out of scope: new queues, databases, Cloudflare/Temporal/web ownership, queue
  metadata, migration/backfill, config knobs, or optimizing non-hosted scanner
  paths.

## Constraints

- Technical constraints: pending index stores only ordered unique input IDs;
  malformed index state must fail closed; terminal evidence semantics must be
  shared with the scanner; no foreground repair/backfill.
- Product/process constraints: preserve foreground priority, preserve mailbox
  consume-ack safety, follow radical simplicity/default-to-deletion guidance.

## Risks and mitigations

1. Risk: Enqueue after mailbox watermark advancement silently strands input.
   Mitigation: enqueue inside the default staging seam before imported success is
   returned; cover watermark non-advance on enqueue/import failure.
2. Risk: Terminal evidence logic drifts between scanner and index compaction.
   Mitigation: extract one helper and use it from both paths.
3. Risk: Old replay/preferred plumbing survives and keeps the scan on the hot
   path.
   Mitigation: delete the concepts and assert the hosted source does not call
   `listAssistantInputEvents`.

## Tasks

1. Extract and export the shared terminal auto-reply evidence predicate.
2. Add hosted pending input ID index read/enqueue/compact/has helpers.
3. Enqueue staged hosted conversation assistant input IDs before import success.
4. Replace hosted input source and selection with direct selected-ID reads.
5. Replace foreground replay/preferred lane params with `freshAssistantInputIds`.
6. Make pending wake and mailbox consume ack use the pending index.
7. Rewrite focused tests and delete tests that only preserve old mechanics.
8. Run scoped verification, completion audits, commit, push, and open PR.

## Decisions

- Source plan: `agent-docs/exec-plans/completed/2026-06-16-hosted-assistant-pending-input-queue.md`
  from the reviewed planning branch. The completed snapshot is not edited in
  this implementation branch.

## Verification

- Commands to run: focused package tests for assistant-runtime hosted runtime and
  assistant-engine automation, package typechecks, repo-required completion
  audits, and any broader checks required by the completion workflow.
- Expected outcomes: tests prove no foreground broad scan, pending-index
  correctness, no input drops before terminal evidence, and no TypeScript errors.
Completed: 2026-06-16
