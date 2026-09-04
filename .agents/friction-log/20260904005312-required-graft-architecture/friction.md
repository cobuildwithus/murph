---
title: 'Required Graft architecture commands are unavailable'
severity: 'minor'
---

## Expected Behavior

The architecture workflow required by `AGENTS.md` can run `graft map` and `graft ask` from a clean task worktree.

## Current Behavior

Both required commands fail because `graft` is not available, so the mandated architecture checks cannot run.

## Possible Solution

Install or expose the reviewed Graft executable through a repository-owned script, or remove the requirement until that executable is part of the supported setup.

## Minimal Reproducible Example

From a clean task worktree, run:

```sh
graft map
graft ask "Which modules own hosted mailbox wake dispatch?"
```

Both commands report that `graft` is not found.

## Context

Runtime reliability work must currently inspect the documented owner paths without the architecture tool that repository policy requires. This creates an avoidable verification gap for every affected task.
