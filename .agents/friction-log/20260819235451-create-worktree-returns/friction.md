---
title: 'create-worktree returns before checkout index stabilizes'
severity: 'minor'
---

## Expected Behavior

scripts/create-worktree should exit only after the new checkout has a stable clean index and all tracked files are materialized.

## Current Behavior

After the helper exits successfully, an immediate git status in the new checkout can transiently report the entire tracked tree as staged deletions with the same files untracked. A later status becomes clean without user action.

## Possible Solution

Before returning success, wait for all checkout and hook work to finish and verify that the new worktree index matches HEAD with no untracked copies of tracked paths.

## Minimal Reproducible Example

1. Retire one clean merged worktree at the regular-worktree ceiling.
2. Create a new branch checkout with scripts/create-worktree.
3. Immediately run git status --short in the new checkout.
4. Observe transient full-tree staged deletions and duplicate untracked paths after the creator already returned success.

## Context

The transient state makes task ownership checks appear catastrophically dirty and can cause automation to stop or operate on a misleading index.
