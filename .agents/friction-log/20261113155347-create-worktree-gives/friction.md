---
title: 'create-worktree gives up after a 5-second lock wait while another worktree checks out'
severity: 'minor'
issue: 'cobuildwithus/murph#4950'
---

## Expected Behavior

When several agents start task worktrees at the same time, `scripts/create-worktree` waits for the serialization lock long enough for one full checkout to finish, or says plainly that the caller should retry.

## Current Behavior

The lock wait is 5 seconds (`flock -w 5` / `lockf -t 5`). A full checkout of this repository takes longer than that, so a second concurrent call prints only `lockf: <repo>/.git/murph-worktree-storage-guard/lock: already locked` and creates nothing. A caller that pipes the output (for example into `tail`) sees no failure and continues without a worktree.

## Possible Solution

Wait longer than one checkout (for example 120 seconds), or print a `create-worktree:` message that names the busy lock and says to retry.

## Minimal Reproducible Example

Start two `scripts/create-worktree --codex-worktree <name> -b <branch> origin/main` calls within a second of each other. The second exits after about 5 seconds with only the `lockf` line.

## Context

A parent agent split one task into four parallel slices, each told to create its own worktree. One slice had to notice the missing worktree and rerun the command.
