---
title: 'Primary pnpm package links can point into retired worktrees'
severity: 'major'
---

## Expected Behavior

Installing workspace dependencies in the primary checkout should leave package symlinks rooted in that checkout or another durable shared store, so retiring an unrelated task worktree cannot break repository commands.

## Current Behavior

The primary checkout's `node_modules` package symlinks pointed into a task worktree that had already been retired. The package content still existed in the primary checkout's pnpm store, but `pnpm exec cobuild-review-gpt` and the global wrapper both failed with a missing-module error until the full workspace install was recreated.

## Possible Solution

Keep primary-checkout dependency symlinks local to the primary checkout, or teach worktree retirement to detect and repair shared pnpm links before removing their target.

## Minimal Reproducible Example

1. Install workspace dependencies while task worktrees share the ordinary pnpm store.
2. Observe a primary-checkout package symlink resolving through a task worktree.
3. Retire that task worktree.
4. Run a binary from the affected package in the primary checkout.
5. Observe a missing-module failure even though the package remains present in the primary checkout's pnpm virtual store.
6. Recreate the primary checkout's `node_modules` and observe the command succeed.

## Context

This interrupted a required ReviewGPT follow-up and forced a full workspace relink before the checked-in binary could run again.
