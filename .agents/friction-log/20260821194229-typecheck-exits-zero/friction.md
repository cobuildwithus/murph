---
title: 'Typecheck exits zero after workspace boundary verification failure'
severity: 'minor'
---

## Expected Behavior

`pnpm typecheck` returns a nonzero status when its workspace-boundary phase reports a violation.

## Current Behavior

The command prints `Workspace boundary verification failed`, continues through the remaining typecheck phases, and exits with status 0 after the TypeScript checks pass.

## Possible Solution

Preserve the boundary-check failure and return it after the aggregated typecheck phases complete.

## Minimal Reproducible Example

1. Run `pnpm typecheck` on a revision with an invalid internal workspace import.
2. Observe the boundary failure diagnostic.
3. Observe that the final process status is still 0 when later TypeScript checks pass.

## Context

This makes a required verification command appear successful even though an earlier owned guard reported a failure.
