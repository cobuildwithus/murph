---
title: 'Batch worktree retirement repeats global safety scans per target'
severity: 'minor'
---

## Expected Behavior

A sanctioned cleanup of many worktrees should preserve exact per-target revalidation while avoiding repeated target-independent scans for every checkout.

## Current Behavior

Each `scripts/retire-worktree` invocation runs the full gate set twice, including a recursive scan of the primary dependency tree. A cleanup with many eligible checkouts therefore repeats the same global scan for every target and can take many minutes per large batch.

## Possible Solution

Add a sanctioned batch owner that snapshots target-independent evidence once, then retains immediate per-target cleanliness, activity, process, history, registration, and dependency-reference revalidation before each non-force removal.

## Minimal Reproducible Example

1. Register several clean inactive synthetic task worktrees.
2. Install dependencies in the primary checkout.
3. Run `scripts/retire-worktree --inactive-no-pr <target>` for each checkout.
4. Observe that `verify_primary_package_links` recursively walks the same primary dependency tree twice per target.

## Context

This makes a user-authorized stale-worktree cleanup scale with both worktree count and primary dependency-tree size even when most evidence is unchanged.
