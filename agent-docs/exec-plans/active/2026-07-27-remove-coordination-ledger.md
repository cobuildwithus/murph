# Remove the coordination ledger

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Remove the tracked coordination ledger and every live workflow dependency on
  it. Keep task isolation in worktrees, active plans, branches, and pull
  requests without a branch-local file pretending to be a global registry.

## Success criteria

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` is deleted and guarded
  against reintroduction.
- Current workflow docs no longer require ledger registration, lookup, cleanup,
  or review.
- `scripts/finish-task` archives and commits an active plan without reading or
  editing shared coordination state.
- Focused repo-tool tests and the canonical diff verification lane pass.

## Scope

- In scope: live agent workflow docs, plan lifecycle docs, `finish-task`,
  repo-tool configuration, focused regression tests, and the ledger deletion.
- Out of scope: immutable completed plans, generated release history, product
  usage ledgers, and unrelated in-flight task plans.

## Constraints

- Technical constraints: preserve plan archival and scoped commit behavior;
  preserve worktree retirement safety; do not add replacement state or a new
  registry.
- Product/process constraints: use one independent mutating task per worktree;
  keep unrelated active plans untouched.

## Risks and mitigations

1. Risk: stale branches could reintroduce the deleted file.
   Mitigation: retain a focused regression asserting that the legacy path stays
   absent.
2. Risk: plan-bearing tasks could stop archiving cleanly.
   Mitigation: simplify the existing `finish-task` harness around the remaining
   plan-close and scoped-commit contract.

## Tasks

1. Delete the ledger and remove live documentation/configuration references.
2. Delete ledger parsing and mutation from `scripts/finish-task`.
3. Replace ledger-coupled tests with absence and plan-lifecycle coverage.
4. Run focused verification, review the full diff, and close the plan.

## Decisions

- Worktrees, branches, pull requests, and task-owned plans remain the existing
  coordination surfaces. No replacement registry is introduced.
- References inside immutable completed plans and release history remain as
  historical facts.

## Verification

- Passed: `bash -n scripts/finish-task`.
- Passed: focused `release-script-coverage-audit` Vitest (40 passed, 1 skipped).
- Passed: `pnpm docs:drift`.
- Passed: `git diff --check`.
- Passed: residue search limited to live workflow sources; only the intentional
  regression assertion and this migration plan still name the removed path.
- Canonical `pnpm test:diff <touched paths>` passed repo guards, all 436
  repo-tool tests, and the affected CLI typecheck. Its unchanged CLI suite was
  blocked by eight assistant subprocess tests timing out at 60 seconds each,
  followed by nine unchanged experiment-suite failures. Both failing files are
  unchanged from the branch base; the task-specific test file passes
  independently.
