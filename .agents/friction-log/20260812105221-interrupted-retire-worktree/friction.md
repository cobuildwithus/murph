---
title: 'Interrupted retire-worktree can leave a registered checkout partially deleted'
severity: 'minor'
issue: 'cobuildwithus/murph#1767'
---

## Expected Behavior

Retiring a clean inactive worktree should either complete or leave the registered checkout intact when the caller is interrupted.

## Current Behavior

The retirement wrapper delegates directly to a recursive `git worktree remove`. When a large checkout takes longer than the caller session and that exact process is interrupted, tracked files can already be removed while the worktree remains registered. A later guarded retirement correctly refuses the now-dirty checkout, but the original clean state is no longer intact.

## Possible Solution

Make the destructive phase resumable or move the checkout to a process-owned quarantine path before recursive removal, so interruption cannot expose a partially deleted registered checkout as ordinary task state.

## Minimal Reproducible Example

1. Create a clean sanctioned task worktree containing a large dependency tree.
2. Confirm `scripts/retire-worktree --dry-run <target>` reports eligible.
3. Start `scripts/retire-worktree <target>` and interrupt only that exact process during recursive removal.
4. Observe that the target remains registered and reports tracked deletions.

## Context

This occurred while reclaiming one guard-approved slot for a new PR-lane task. Tracking the exact long-running process to completion avoided the failure on the next eligible checkout.
