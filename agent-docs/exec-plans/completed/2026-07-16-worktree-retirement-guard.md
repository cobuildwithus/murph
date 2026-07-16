# Mechanical task worktree retirement

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Give every agent one fail-closed command for retiring a terminal task
  worktree without deleting its branch or risking active work.

## Success criteria

- The helper accepts one exact registered task worktree and removes it only
  after proving that its exact PR head is merged or closed, or its HEAD is
  already contained in `origin/main`; the checkout must also be non-primary,
  non-current, clean, unlocked, free of current-user process working
  directories, and unreferenced by either checkout's active-task registry.
- Missing or ambiguous PR, registry, cleanliness, process-use, or active-task
  evidence preserves the checkout with a useful non-identifying failure.
- The completion workflow makes the helper the mandatory post-merge or
  post-close retirement path while keeping open PR worktrees intact.
- Focused harness tests prove successful non-force retirement, branch
  preservation, and the important fail-closed gates.

## Scope

- In scope: one repo-owned retirement helper, its focused tests and syntax
  wiring, and compact workflow documentation.
- Out of scope: a resident daemon, cron job, forced removal, branch deletion,
  raw directory deletion, process termination, or removal of open-PR worktrees.

## Constraints

- Preserve unrelated worktrees, branches, plans, ledger rows, and local edits.
- Keep all user identifiers and home-directory paths out of committed output.
- Use Git and GitHub as the existing registry and PR-state owners; add no
  dependency or persisted cleanup state.

## Tasks

1. Implement the exact-target, fail-closed retirement helper.
2. Add focused success and refusal-path harness coverage.
3. Route post-merge and post-close completion through the helper.
4. Run scoped verification, the required coverage audit, and parent review.
5. Commit, push, open the PR, and preserve this worktree while the PR is open.

## Verification

- Shell syntax and privacy scans for the helper and changed artifacts.
- Focused repo-tool tests covering terminal PR proof, process use, cleanliness,
  current/primary protection, non-force removal, and branch preservation.
- `pnpm test:diff` for all touched workflow/tooling paths when host capacity is
  safe, plus a direct disposable-repository scenario.

## Completion evidence

- The focused disposable-repository harness passes all five cases, including
  merged and closed PRs, contained history, ignored dependency artifacts,
  target-only active coordination, second-pass PR-state races, empty process
  evidence, live process CWDs, and branch preservation.
- Scoped `pnpm test:diff` passes shell and Node syntax, hosted-runtime guards,
  repo-tool typechecking, 23 repo-tool test files with 343 tests, and dependency
  policy across 31 manifests.
- The required coverage-write pass added the second-pass race regression and
  identified the empty-process-evidence gap; both are now covered.
- Focused parent and independent safety review found two issues: target-only
  active coordination and overly broad process-stop wording. Both were fixed,
  re-reviewed, and returned zero remaining concrete findings.
- `git diff --check` and the touched-file privacy scan pass with no identifier
  matches.
Completed: 2026-07-16
