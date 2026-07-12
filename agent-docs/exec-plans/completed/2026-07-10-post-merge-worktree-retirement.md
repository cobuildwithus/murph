# Post-merge worktree retirement

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make dedicated task worktrees explicitly temporary and require safe retirement after their PR is confirmed merged or closed.

## Success criteria

- The authoritative workflow router defines when a task worktree must be preserved and when it must be retired.
- The retirement gate refuses dirty, untracked, locked, process-used, active-task, open-PR, primary, and current worktrees.
- Completion guidance points agents to the same gate when merge or closure is confirmed.
- Vague duplicate guidance is replaced with a pointer to the authoritative rule.
- Repo-local `.worktrees/` directories are ignored so local task checkouts cannot appear as repository residue.
- Required documentation checks, tests, and typecheck pass.

## Scope

- In scope: agent workflow documentation and index entries for dedicated git worktree lifecycle and post-merge cleanup, plus the repo-local `.worktrees/` ignore rule.
- Out of scope: automatic branch deletion, force removal, global worktree pruning, runtime cleanup helpers, and retroactive removal of active worktrees.

## Constraints

- Technical constraints: `scripts/finish-task` runs before merge and often inside the task worktree, so retirement remains a separate post-merge action.
- Product/process constraints: preserve unrelated work and branches by default; never trade disk cleanup for lost or disrupted work.

## Risks and mitigations

1. Risk: an eager agent removes a checkout that still contains work or supports a live task.
   Mitigation: require explicit merge/closure plus clean-state, process, PR, plan, ledger, lock, and current-worktree gates; preserve and report on any failed gate.
2. Risk: duplicated lifecycle wording drifts.
   Mitigation: keep the full rule in the workflow router and use short cross-references elsewhere.

## Tasks

1. Add the durable task-worktree retirement gate to the workflow router.
2. Add completion and Claude-facing cross-references to the authoritative gate.
3. Ignore repo-local `.worktrees/` directories and remove or preserve existing entries through the same safety gates.
4. Read back the docs, search for contradictions, and run required verification.
5. Close the plan and create a scoped commit.

## Decisions

- Preserve the task branch by default; worktree retirement and branch deletion are separate decisions.
- Do not add worktree deletion to `scripts/finish-task` and do not run `git worktree prune` as part of task retirement.

## Verification

- Commands to run: `git diff --check`; `pnpm docs:drift`; `pnpm test:diff <changed paths>` (the complete scoped test and typecheck lane); targeted stale-wording/ignore searches and doc readback.
- Expected outcomes: all checks pass, the three docs describe one safe lifecycle without contradictory cleanup instructions, and `.worktrees/` is ignored.
Completed: 2026-07-10
