---
title: 'Docs drift CI mode destroys the local merge-base proof in shallow worktrees'
severity: 'minor'
---

## Expected Behavior

Running `GITHUB_BASE_REF=main pnpm docs:drift` in a sanctioned shallow task worktree should compare the task head with the fetched base branch.

## Current Behavior

The wrapper fetches the base with `--depth=1`. In a shared shallow repository this can replace the existing remote boundary with the latest base commit as a grafted root, after which `origin/main...HEAD` has no merge base. The command then catches both diff failures, reports no changed files, and can incorrectly finish without checking the task's durable documents.

## Possible Solution

Preserve existing ancestry or deepen the specific base/head histories until `git merge-base origin/$GITHUB_BASE_REF HEAD` succeeds, then fail closed if it still does not.

## Minimal Reproducible Example

1. Create a sanctioned task worktree from a recently merged base in a shallow shared repository.
2. Let the remote base advance.
3. Run `GITHUB_BASE_REF=main pnpm docs:drift`.
4. Observe two `no merge base` errors followed by `No changed files detected`.

## Context

This can silently skip durable-document drift checks on PR work and required a plain local `pnpm docs:drift` run to verify the working-tree changes.
