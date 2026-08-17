---
title: 'Detached worktrees cannot use the required retirement helper'
severity: 'minor'
---

## Expected Behavior

A detached worktree created through `scripts/create-worktree --detach` for frozen-base verification should have a repository-approved clean retirement path.

## Current Behavior

`scripts/retire-worktree` rejects every detached target because it requires a local branch. Repository policy also forbids raw `git worktree remove`, so a clean finished verification checkout cannot be retired without creating unrelated branch state and requesting broader cleanup authority.

## Possible Solution

Teach `scripts/retire-worktree` to accept a clean, unlocked, detached checkout when its exact HEAD is contained in `origin/main`, while preserving the existing registry, process, nested-worktree, and active-reference checks.

## Minimal Reproducible Example

1. Create a frozen-base checkout with `scripts/create-worktree --detach <synthetic-path> <commit-on-origin-main>`.
2. Finish verification and confirm `git status --short` is empty.
3. From another checkout, run `scripts/retire-worktree <synthetic-path>`.
4. Observe `target is not backed by a local branch`.

## Context

Required base-versus-head provider-input verification leaves an otherwise disposable checkout registered and consuming the global worktree allowance.
