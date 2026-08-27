---
title: 'Fresh task worktrees cannot open execution plans before full dependency linking'
severity: 'minor'
issue: 'cobuildwithus/murph#2389'
---

## Expected Behavior

The repository plan helper should create a Markdown execution plan in a freshly created sanctioned task worktree without requiring the complete workspace dependency graph to be linked first.

## Current Behavior

Running `bash scripts/open-exec-plan.sh <slug> <title>` in a fresh sanctioned worktree exits because the repo-tools consumer shell helper is unavailable. The only documented recovery is a full frozen-lockfile workspace install, which links every workspace dependency before a Markdown plan can be opened.

## Possible Solution

Keep the plan-open path dependency-free, or provide a repository-owned bootstrap that materializes only the helper needed for plan creation.

## Minimal Reproducible Example

1. Create a sanctioned task worktree with `scripts/create-worktree`.
2. Before installing dependencies, run `bash scripts/open-exec-plan.sh sample "Sample plan"`.
3. Observe the missing repo-tools consumer helper error.

## Context

This delays the required plan-before-code workflow for ordinary multi-file task work in new worktrees and performs much broader setup than plan creation needs.
