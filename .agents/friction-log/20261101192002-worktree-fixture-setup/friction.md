---
title: 'Worktree fixture setup commits bypass synthetic disk environment'
severity: 'minor'
issue: 'cobuildwithus/murph#4429'
---

## Expected Behavior

Worktree storage guard tests should use their synthetic filesystem capacity for setup commits after installing Git hooks, regardless of the CI runner's real free space.

## Current Behavior

The release build/typecheck job fails in two fixture setup commits when the runner has 9 GiB free. Their runGit calls inherit the host environment, while create-worktree installed a pre-commit hook requiring 20 GiB. Neither failure exercises Meals behavior.

## Possible Solution

Pass the existing guardEnvironment fixture to those setup commits. Keep the production threshold and the low-space rejection tests unchanged.

## Minimal Reproducible Example

Run the repo-tools worktree-storage-guard suite on a runner below 20 GiB free. The successful-hook Spotlight test and interrupted-materialization test fail during setup before reaching their intended assertions.

## Context

Observed in PR #4420, Actions run 41366207622. The focused correction keeps disk evidence synthetic rather than relaxing the production guard.
