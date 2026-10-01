# Acknowledge self-authored first-turn echoes

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Prevent a self-authored Linq delivery echo from leaving its durable
  conversation mailbox row permanently unacknowledged after an instant first
  reply, while preserving the current rule that the echo is never offered to
  the assistant provider as user work.

## Success criteria

- Every imported self-authored Linq event receives a restart-safe terminal
  disposition and remains visible to the existing pending-input checkpoint
  compactor until Web confirms the exact mailbox row was consumed.
- A self-authored reply still terminalizes only the exact pending inbound it
  answers and preserves the existing assistant transcript exchange.
- Self-authored input remains absent from runnable assistant selection and does
  not trigger foreground provider preparation or active-turn notification.
- Focused regression tests reproduce a contiguous inbound sequence followed by
  its outbound echo and prove both mailbox rows become selectable for handling.
- Relevant package tests and typecheck pass, the parent inspection accepts the
  candidate, and required ReviewGPT/CI gates run against the exact pushed head.

## Scope

- In scope: the assistant-runtime conversation source adapter, its existing
  pending-input/terminal-evidence owner, focused regression coverage, and the
  durable owner description if the contract needs clarification.
- Out of scope: a new queue, scheduler, state schema, retry loop, provider
  execution path, onboarding follow-up behavior, production data repair,
  deployment, and unrelated mailbox or delivery refactors.

## Constraints

- Technical constraints: reuse the existing AssistantInputEvent, suppression
  evidence, pending index, mailbox-item association, checkpoint selection, and
  runtime write-lock boundaries. Fail closed if terminal bookkeeping cannot be
  persisted. Preserve replay idempotency and checkpoint ordering.
- Product/process constraints: ReviewGPT authors the initial proposed patch;
  the parent inspects and deliberately applies it. Use only synthetic test data,
  keep the PR draft until local proof and parent review are complete, and run
  preliminary specialist plus final ReviewGPT concurrently with CI on the exact
  candidate head.

## Risks and mitigations

1. Risk: indexing the echo could accidentally make it runnable provider work.
   Mitigation: write terminal suppression evidence before exposing the echo to
   the existing index and assert runnable selection remains empty.
2. Risk: a crash between event staging, mailbox association, terminal evidence,
   and index publication could acknowledge incomplete work or strand the row.
   Mitigation: preserve fail-closed importer failure/replay semantics and prove
   the staged transition is idempotent.
3. Risk: the fix broadens into a second acknowledgement mechanism.
   Mitigation: extend only the current pending-input owner and checkpoint
   compactor contract; add no new persisted field, owner, or recovery loop.

## Tasks

1. Give ReviewGPT a privacy-safe implementation brief plus the exact current
   source and focused tests, and capture its proposed patch.
2. Inspect the proposal against the production evidence, owner boundaries,
   replay/failure ordering, and simplicity constraints.
3. Apply the accepted minimal code and regression changes.
4. Run focused tests, package typecheck, diff/privacy checks, and parent review.
5. Finish the scoped plan commit, push, open a draft PR, and start required
   ReviewGPT gates concurrently with CI on the exact pushed head.
6. Resolve or disposition gate results under the repository stopping rules.

## Decisions

- Keep self-authored Linq events non-runnable; the missing state is terminal
  acknowledgement evidence, not reply eligibility.
- Reuse the pending-input index's deliberate retention of terminal conversation
  inputs until Web's consumed floor proves the checkpoint committed.
- Treat the onboarding early-stall follow-up as separate, unchanged behavior.
- Accepted ReviewGPT's terminal-evidence-before-index production design and
  categorical `actorIsSelf` replyability guard. Rejected only its redundant
  test step that changed immutable replay content by adding `durablyConsumed`
  to an already-staged event; ordinary exact replay and consumed-floor cleanup
  remain directly covered.

## Verification

- Commands to run: focused assistant-runtime mailbox-import and pending-index
  Vitest files; assistant-runtime typecheck; `git diff --check`; privacy scan;
  the repository's scoped commit/PR checks; required exact-head ReviewGPT and CI.
- Expected outcomes: the synthetic inbound plus self-authored echo are both
  selected as handled at the contiguous frontier, neither is runnable after the
  echo, and replay leaves one idempotent terminal/indexed record per mailbox row.
- Passed: focused assistant-runtime Vitest run for the mailbox-import and
  pending-index files, 108 tests.
- Passed: assistant-runtime package typecheck under Node 24.14.1.
- Passed: `git diff --check`; the added-line privacy scan found no direct
  identifier or home-directory path.
Completed: 2026-08-27
