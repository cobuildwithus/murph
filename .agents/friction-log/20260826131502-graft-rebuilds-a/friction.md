---
title: 'Graft rebuilds a large untracked index in fresh task worktrees'
severity: 'minor'
issue: 'cobuildwithus/murph#2354'
---

## Expected Behavior

A Graft query should use the repository index without adding task files or hundreds of megabytes to the worktree.

## Current Behavior

The first Graft query in a fresh sanctioned worktree refreshed the graph and created an untracked graft directory of about 656 MB. This blocks a clean scoped task handoff until the generated directory is removed.

## Possible Solution

Use a shared cache outside the worktree, or ensure generated graph state is ignored and cleaned automatically.

## Minimal Reproducible Example

1. Create a sanctioned task worktree.
2. Run `graft grep "a known UI string"`.
3. Run `git status --short` and `du -sh graft`.

## Context

This happened during a small Environment UI and coverage fix. The generated index was much larger than the product diff and required cleanup before commit.
