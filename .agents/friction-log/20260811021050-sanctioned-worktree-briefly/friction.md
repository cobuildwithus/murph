---
title: 'Sanctioned worktree briefly reports every tracked file deleted'
severity: 'minor'
---

## Expected Behavior

After scripts/create-worktree reports success, an immediate git status should show a clean task checkout.

## Current Behavior

The first status in a newly created sanctioned worktree reported every tracked file as deleted while the same paths appeared untracked. Subsequent index and blob inspection showed the checked-out files matched HEAD exactly, and a later status became clean without content changes.

## Possible Solution

Have the creator verify a clean status after checkout completion and retry the refresh or fail closed before reporting success.

## Minimal Reproducible Example

1. Create a branch worktree from origin/main with scripts/create-worktree.
2. Immediately run git status --short --branch in the new checkout.
3. Observe repository-wide deletions and matching untracked paths.
4. Inspect exact index and worktree blobs, then rerun status and observe a clean checkout.

## Context

The transient state looked like a repository-wide destructive diff and blocked a security configuration change until the checkout could be proven safe.
