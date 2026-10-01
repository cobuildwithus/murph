# Frog #2412: finish-task staged plan archival

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Make `scripts/finish-task` archive and commit a newly created active plan even when that plan is already staged.

## Success criteria

- A focused harness reproduces the current staged-plan failure before the fix.
- `finish-task` records only the completed plan in the commit and leaves no active-plan residue or staged duplicate.
- Existing tracked-plan, untracked-plan, and deleted-task-path behavior remains covered.
- Focused verification, repository tooling checks, ReviewGPT, and required PR CI pass.

## Scope

- In scope: `scripts/finish-task`, its focused release-script harness, and this plan.
- Out of scope: repo-tools package changes, unrelated commit behavior, product/runtime behavior, and dependency changes.

## Constraints

- Technical constraints: preserve exact-path commit scoping and staged-index safety; do not weaken worktree or hook guards.
- Product/process constraints: keep the patch repository-local and low-risk; use the exact committed Frog entry as authority.

## Risks and mitigations

1. Risk: staging the archive could leave a duplicate active plan or disturb unrelated staged work.
   Mitigation: stage only the old/new plan paths, exercise the real repo-tools committer in a synthetic Git harness, and assert exact final index/commit state.

## Tasks

1. Add and run a focused failing regression for an already-staged new active plan.
2. Implement the smallest archive-staging correction in `scripts/finish-task`.
3. Run focused and repository-tooling verification, inspect the diff, and complete the PR review/CI lane.

## Decisions

- Treat a newly staged plan separately from a plan tracked in `HEAD`: the former has no source path for the scoped committer to resolve after archival.
- Normalize the exact archive paths in the real index before invoking the isolated committer, so failure leaves one staged completed plan instead of a staged vanished source plus an untracked destination.

## Verification

- Commands to run: focused Vitest for the finish-task harness, shell syntax, repo-tools test suite, and diff/privacy checks.
- Expected outcomes: the staged-plan regression commits only the completed plan and task path, while all existing finish-task cases continue to pass.
- Completed: the focused staged/untracked pair passed 2/2; the full release-script audit passed 49 tests with one intentional skip; `packages/cli` typecheck passed; `pnpm test:repo-tools` passed 49 files / 677 tests; Bash syntax and diff hygiene passed.
Completed: 2026-08-29
