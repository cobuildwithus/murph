---
title: 'Docs drift local large-change threshold is overwritten by shared config'
severity: 'minor'
---

## Expected Behavior

A plain working-tree docs check should honor the documented local threshold, while staged and CI checks retain the strict plan requirement.

## Current Behavior

The wrapper sets COBUILD_DRIFT_LARGE_CHANGE_THRESHOLD before sourcing repo-tools.config.sh, which unconditionally resets it to 10. The documented local exception therefore never applies.

## Minimal Reproducible Example

In a disposable checkout, change at least ten files without a plan and run pnpm docs:drift. Setting MURPH_WORKTREE_DRIFT_LARGE_CHANGE_THRESHOLD above the changed count still reports the large-change plan error.

## Possible Solution

Apply the local override after sourcing shared defaults, or preserve an already-selected threshold in the shared config. Keep the staged and CI checks strict.

## Context

Discovered during local verification of a multi-package cache change. A separate task execution record satisfies the guard; the parent plan remains on another branch.
