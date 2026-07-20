# Enforce worktree storage budget

Status: completed
Created: 2026-07-18
Updated: 2026-07-18

## Goal

- Prevent local task worktrees from silently exhausting host storage while preserving active PRs and explicitly retained data/research work.

## Success criteria

- New worktree creation and repo commit paths fail closed when the live-worktree or free-space budget is exceeded.
- Long-running data/research work has a documented native Git lock path that the retirement helper already honors.
- The guard is directly tested for healthy, excess-worktree, and low-free-space cases.
- Current stale storage is audited and only verified disposable data is removed.

## Scope

- In scope: repo-internal worktree guard/tooling, lifecycle policy, focused tests, and local cleanup of rebuildable artifacts.
- Out of scope: force-removing any worktree; removing dirty, detached, active, open-PR, or protected data/research worktrees; pruning Git metadata; or deleting personal media and user documents.

## Constraints

- Technical constraints: preserve branches; use `scripts/retire-worktree` for retirement; keep checks fast enough for commit/create paths; avoid absolute user paths in committed artifacts.
- Product/process constraints: active PRs and locked data/research worktrees must remain usable; cleanup fails closed on ambiguous state.

## Risks and mitigations

1. Risk: a guard blocks legitimate small-disk development hosts.
   Mitigation: use proportional free-space policy with a modest absolute floor and focused tests.
2. Risk: automatic cleanup removes active or valuable data work.
   Mitigation: enforce only admission/commit checks in repo tooling; keep deletion behind the existing fail-closed helper and native worktree locks.

## Tasks

1. Audit current storage and safely retire helper-approved stale worktrees.
2. Add a fast storage-budget guard and guarded worktree-creation wrapper.
3. Wire the guard into commit paths, document data-work retention locks, and add an explicit user-authorized inactive/no-PR retirement mode that preserves branches and every other retirement gate.
4. Add focused tests and run scoped verification plus the required completion review.

## Decisions

- Count live registered worktree directories, not stale/prunable metadata records.
- Ratchet a machine-local legacy ceiling down toward 40 regular worktrees, mark every wrapper-authorized worktree in Git's local administrative directory, and install the primary checkout's hook as the shared branch-independent commit backstop so raw old-branch creation still fails the next ordinary commit.
- Serialize creation and guard state with a process-owned advisory lock that the operating system releases after crashes or abrupt exits.
- Fail when available disk on the primary checkout, any live valid worktree, or a prospective worktree target falls below the greater of 20 GiB and 15% of that filesystem's capacity.
- Use `git worktree lock --reason` with a `data/research:` reason as the durable retention primitive for long-running data/research tasks; these remain subject to the disk floor.

## Verification

- Commands to run: focused guard tests, shell syntax checks, `pnpm test:diff` for touched repo-tooling paths, direct healthy/failing guard scenarios.
- Expected outcomes: all checks pass; current checkout remains scoped; cleanup measurements and preserved-state categories are reported.

## Results

- Focused guard/retirement verification passed 19 tests; the exact diff-aware repo-tooling lane passed 24 files and 357 tests.
- Coverage-write and the final remediated deep-review pass completed with no unresolved findings.
- Direct host proof reported 78 regular and 5 protected data/research worktrees at the ratcheted ceiling with 18% free space; prospective regular creation remained blocked.
- Safe host cleanup raised available space from about 206 GiB to 339 GiB. This continuation retired 113 helper-approved worktrees, stripped rebuildable artifacts from 135 additional inactive worktrees, and preserved branches plus every ambiguous, active, process-held, dirty, detached, open-PR, invalid, or protected data/research checkout.
Completed: 2026-07-18
