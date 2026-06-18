# PR 216 Mailbox Conflict And Replay Fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Resolve PR 216 merge conflicts and fix accepted mailbox replay regressions without broadening hosted runtime authority or adding cursor complexity.

## Success criteria

- PR branch merges cleanly with `main`.
- AI usage gating ignores replay-only conversation rows at or below both imported and server-consumed floors while still denying fresh conversation tails.
- Retention preserves conversation rows above the consumed watermark and repairs already-retained gaps to an effective consumed floor before fetch.
- `limitAllowance` cursor state is removed and replay-prefix allowance is derived from cursor floors inside fetch.
- Focused regressions cover the denied replay prefix plus ungated system work, the fresh denied tail, and the retained-gap repair case.

## Scope

- In scope: hosted mailbox store/fetch cursors, internal fetch route gating, hosted retention cleanup, assistant-runtime mailbox import expectations, directly relevant tests.
- Out of scope: new mailbox tables, new background repair jobs, new scheduler/retry systems, broad hosted runtime refactors.

## Constraints

- Technical constraints: preserve mailbox lane ordering, fail closed for fresh conversation work, keep background system work ungated unless its kind is already gated, avoid deleting unconsumed conversation rows.
- Product/process constraints: preserve privacy guardrails, keep changes minimal, use repo completion workflow verification and audits.

## Risks and mitigations

1. Risk: repairing effective consumed floors could hide genuinely pending conversation input.
   Mitigation: only repair to the sequence immediately before the oldest retained row, and only when a retained lane has no fetchable rows at or below the stale floor.
2. Risk: gating could allow fresh conversation rows for AI-denied users.
   Mitigation: gate only conversation rows above both imported and server-consumed floors, with regression coverage for a fresh denied tail.

## Tasks

1. Merge current `main` into the PR branch and resolve conflicts.
2. Inspect existing hosted mailbox, retention, fetch route, and assistant-runtime mailbox import code.
3. Implement the three scoped fixes.
4. Add focused regressions.
5. Run focused tests, typecheck or truthful scoped verification, required audits, final diff review, commit, push, and PR review loop as applicable.

## Decisions

- Use derived replay allowance rather than storing `limitAllowance` in the cursor contract.

## Verification

- Commands to run: focused hosted mailbox/retention tests, `pnpm test:diff` scoped to touched files, and `pnpm typecheck` unless blocked by unrelated branch state.
- Expected outcomes: all focused regressions pass, scoped diff verification is green or any unrelated blockers are identified with concrete failing targets.
Completed: 2026-06-18
