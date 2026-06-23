# Completion workflow ReviewGPT base update note

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Clarify in the completion workflow that agents should not rerun the PR-lane ReviewGPT loop after a zero-finding round when the only later PR update is a normal merge or rebase of `main` or the PR base branch.

## Success criteria

- `agent-docs/operations/completion-workflow.md` carries the same base-update-only exception already documented in the PR deep-review loop.
- The change stays docs/process-only and does not alter scripts, tests, app code, or package code.

## Scope

- In scope: `agent-docs/operations/completion-workflow.md`.
- Out of scope: ReviewGPT tooling, PR loop command changes, runtime code, app/package behavior.

## Constraints

- Technical constraints: keep the wording narrow and consistent with `agent-docs/operations/pr-deep-review-loop.md`.
- Product/process constraints: preserve the existing requirement to rerun ReviewGPT for manual conflict resolution or any non-base-update change.

## Risks and mitigations

1. Risk: Agents could skip ReviewGPT after real conflict-resolution or behavior changes.
   Mitigation: State the exception only for ordinary merge/rebase updates with no manual conflict resolution or other edits.

## Tasks

1. Add the narrow exception note to the completion workflow.
2. Read back the changed docs and run docs-only verification.
3. Close the plan with a scoped commit.

## Decisions

- Mirror the PR deep-review loop's base-update-only exception in the completion workflow sequence instead of inventing a separate rule.

## Verification

- Direct readback confirmed the completion workflow now says not to rerun ReviewGPT when the only post-zero-finding update is a normal merge/rebase of `main` or the PR base branch with no manual conflict resolution or other edits.
- `git diff --check -- agent-docs/operations/completion-workflow.md agent-docs/exec-plans/active/2026-06-22-reviewgpt-base-update-note.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` passed.
- `pnpm test:diff agent-docs/operations/completion-workflow.md agent-docs/exec-plans/active/2026-06-22-reviewgpt-base-update-note.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed on the repo-internal fast path.
Completed: 2026-06-22
