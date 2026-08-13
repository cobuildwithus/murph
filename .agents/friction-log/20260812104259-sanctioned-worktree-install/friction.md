---
title: 'Sanctioned worktree install fails on transient storage-guard lock contention'
severity: 'minor'
---

## Expected Behavior

Installing an unchanged frozen workspace in a sanctioned worktree should complete when dependency linking succeeds. Hook setup should tolerate ordinary contention on the repository's existing storage-guard lock or retry within a bounded interval.

## Current Behavior

The install completes dependency linking, then the prepare hook invokes hook installation and exits nonzero when another repository process briefly owns the storage-guard lock. The caller receives an install failure even though package installation itself completed.

## Possible Solution

Make the prepare-owned hook installation acquire the existing lock with a bounded retry, or treat a concurrently held lock as a deferred hook-refresh outcome when the already-installed global hook remains valid.

## Minimal Reproducible Example

1. Create a sanctioned task worktree with `scripts/create-worktree`.
2. While another repository process holds the worktree-storage guard lock, run `pnpm install --frozen-lockfile` in the task worktree.
3. Observe dependency linking complete, followed by a prepare failure from the contended guard lock.

## Context

This turns normal concurrent repository work into a false dependency-install failure and forces callers to distinguish a completed link step from a failed hook-refresh step before running focused tests.
