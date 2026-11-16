---
title: 'create-worktree refuses at the worktree ceiling while merged clean worktrees stay registered'
severity: 'minor'
---

## Expected Behavior

When `scripts/create-worktree` refuses because the ratcheted worktree ceiling is reached, a task agent has a sanctioned way forward: the refusal names the registered worktrees that `scripts/retire-worktree` would accept (clean, HEAD contained in `origin/main` or PR merged), or the ceiling does not count them.

## Current Behavior

The refusal only prints the counts (`regular=200 ... ceiling=200`). On a shared machine many registered worktrees belong to other sessions and are already merged and clean, but a task agent may not retire another session's checkout, so it can only wait until someone else frees a slot. A delegated bug fix waited roughly half an hour before it could create its checkout.

## Possible Solution

Have the refusal list retire-eligible worktrees (the same check `scripts/retire-worktree --dry-run` runs) so the owning operator can free slots in one step, or exclude retire-eligible worktrees from the ceiling count.

## Minimal Reproducible Example

1. Register worktrees until the ceiling is reached, with some of them clean and contained in `origin/main`.
2. Run `scripts/create-worktree --codex-worktree murph-example -b example origin/main`.
3. It refuses with only the counts; nothing names the eligible retirements.

## Context

Hit while starting an approved production fix in an isolated worktree. The fix itself was unaffected once a slot was freed.
