---
title: 'Worktree pool at the ceiling has no releasable candidate'
severity: 'minor'
---

## Expected Behavior

When `scripts/create-worktree` refuses because the regular worktree count is at
the ratcheted ceiling, an agent should be able to release at least one slot with
`scripts/retire-worktree` and continue the task.

## Current Behavior

At the ceiling, every retirable candidate is refused. Branch-backed checkouts
whose HEAD is already contained in `origin/main` are refused with `target is
still referenced by active task coordination`, and detached checkouts left over
from one-off measurements are refused with `target is not backed by a local
branch`. The pool cannot shrink through the supported path, so a new task cannot
get a worktree at all and falls back to the primary checkout, which the routing
docs discourage for independent mutating work.

## Possible Solution

Let `retire-worktree` release a clean detached checkout whose HEAD is contained
in `origin/main`, since there is no branch or PR state to protect. Separately,
report which coordination record still references a merged branch-backed
checkout so a stale reference can be cleared.

## Minimal Reproducible Example

```sh
# with the pool at the ceiling
scripts/create-worktree -b task/example ../murph-example origin/main
# worktree storage guard: new worktree would exceed the ratcheted ceiling of 100

scripts/retire-worktree --dry-run ../some-merged-branch-worktree
# retire-worktree: refusing: target is still referenced by active task coordination

scripts/retire-worktree --dry-run ../some-detached-baseline-worktree
# retire-worktree: refusing: target is not backed by a local branch
```

## Context

Hit while starting a tiny single-package change. `git worktree prune` removed
only an already-missing directory and did not lower the count, so the task ran on
a branch in the primary checkout instead of an isolated worktree.
