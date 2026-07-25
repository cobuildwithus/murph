# Complete 14-day inbound message retention

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Remove inbound-message verbatim content from every in-scope durable,
  searchable, and assistant-readable carrier after the receipt-anchored
  14-day window, while retaining structural conversation facts, distilled
  canonical memory, and restart-safe terminal handling for accepted work.

## Success criteria

- A reviewed carrier inventory names the retention behavior for the hosted
  mailbox, v1/v2 inbox captures and envelopes, SQLite projection/FTS rows,
  parser derivatives, assistant inputs/transcripts, and hosted mailbox
  quotations.
- One existing hosted idle-maintenance owner derives the earliest retention
  deadline for both capture-backed and captureless content and schedules a
  wake without unrelated member activity.
- Retention never deletes or hides an unconsumed conversational obligation
  without a durable terminal disposition owned by the existing accepted-work
  path.
- Partial cleanup is retry-safe: no canonical marker can prevent a later pass
  from clearing an in-scope snapshot-carried copy after a transient failure.
- Receipt time, not projection time, anchors expiry; protected work is
  re-evaluated at a bounded existing wake.
- Focused production-path regressions, the canonical repository acceptance
  command, required audits, final ReviewGPT, and PR CI all pass on the final
  pushed head.

## Scope

- In scope:
  - `HostedMailboxItem` live-read and cleanup retention behavior.
  - Inbox capture/envelope canonical records and raw content files.
  - Inbox SQLite projection, attachment text, and FTS state.
  - Capture-owned parser text derivatives.
  - Assistant input and transcript content plus their hosted snapshot wake.
  - Existing retention scheduling, retry, and checkpoint integration.
  - Current architecture, security, reliability, and verification docs.
- Out of scope:
  - Distilled canonical memory, promoted health/events, and ordinary durable
    captures intentionally created from a message.
  - Provider-side retention and unrelated stores not carrying inbound message
    bodies.
  - New retention services, queues, lifecycle tables, or reconciliation loops.

## Constraints

- Technical constraints:
  - Reuse current owners and one existing retention wake pointer.
  - Keep canonical shard rewrites and owned-file deletion atomic.
  - Keep the foreground reply path free of retention work.
  - Preserve optional/additive persisted-shape compatibility and existing
    mailbox causal ordering.
- Product/process constraints:
  - The 14-day guarantee must be truthful across every declared carrier.
  - Accepted work must not become unexplained silence.
  - Redaction is irreversible, so deploy-skew and rollback behavior must be
    explicit.
  - Continue PR #936's immutable ReviewGPT baseline and retrospective rather
    than resetting the review history.

## Risks and mitigations

1. Risk: A privacy deadline silently erases accepted but unhandled work.
   Mitigation: route expiry through the existing terminal-disposition owner or
   retain the obligation without retaining its private payload.
2. Risk: Carrier-by-carrier patches leave a hidden verbatim copy or a
   non-retryable partial state.
   Mitigation: complete the inventory first, select one completion boundary,
   and test transient failure after each durable step.
3. Risk: A new scheduler or state owner makes retention less reliable.
   Mitigation: derive the earliest deadline through existing idle maintenance
   and reuse its current wake/backoff state.
4. Risk: Web and runner deploy out of order around irreversible deletion.
   Mitigation: preserve additive readers, state the safe deploy order, and
   prove warm-old-runner behavior before handoff.

## Tasks

1. Reconcile the branch with current `main`, inspect the current patch and all
   ReviewGPT findings, and trace every message-content carrier and owner.
2. Write the smallest owner-level design for mailbox terminality, captureless
   deadline scheduling, complete carrier cleanup, and retry-safe completion.
3. Add failing production-path regressions for the two unresolved ReviewGPT
   mechanisms and any inventory gap still present at the current head.
4. Implement the correction through existing owners, deleting or consolidating
   superseded carrier-specific machinery where possible.
5. Update durable owner docs and the PR intent/deployment contract to match the
   final behavior and carrier inventory.
6. Run focused checks and direct scenario proof, then
   `pnpm verify:acceptance`.
7. Run the required local product-experience review, parent final review, and
   exact-head completion workflow.
8. Close the plan with `scripts/finish-task`, push, run the next final
   ReviewGPT correction round concurrently with CI, resolve findings, and prove
   a clean merge with current `main`.

## Decisions

- Continue the original complete 14-day retention outcome rather than narrowing
  the PR to a partial guarantee.
- Treat the round-2 `RETROSPECTIVE_REQUIRED` result as the governing redesign
  checkpoint; do not add another isolated carrier patch.

## Verification

- Commands to run:
  - Focused Vitest suites for every touched owner during iteration.
  - Production-path retention/checkpoint/restore/search/later-turn scenario.
  - `pnpm verify:acceptance`.
  - `scripts/review-gpt-pr-head-preflight.sh 936`.
- Expected outcomes:
  - No in-scope unique phrase survives in a durable carrier after the scheduled
    retention pass and restore.
  - Structural facts and distilled canonical records remain.
  - Unconsumed accepted work has an explicit restart-safe terminal outcome.
  - Required audits, ReviewGPT, PR CI, and merge-conflict proof are green.
