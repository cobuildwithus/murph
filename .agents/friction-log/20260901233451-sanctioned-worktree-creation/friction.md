---
title: 'Sanctioned worktree creation returns before the checkout index stabilizes'
severity: 'minor'
---

## Expected Behavior

`scripts/create-worktree` should return only after the new checkout is ready for an immediate `git status` and task work.

## Current Behavior

Immediately after a successful sanctioned creation, the new checkout can temporarily report every tracked file as staged for deletion while the same files appear untracked. A later status becomes clean without intervention, showing that creation returned before index stabilization completed.

## Possible Solution

Add a final index/worktree consistency check after checkout materialization and before the helper returns.

## Minimal Reproducible Example

1. Create a task checkout with `scripts/create-worktree -b fix/example ../example-worktree origin/main`.
2. Immediately run `git status --short --branch` in the new checkout.
3. Observe a transient whole-tree deletion-plus-untracked state that later clears without mutation.

## Context

This blocks safe immediate task startup because the repository workflow correctly treats unexpected dirty state as ownership-sensitive.
