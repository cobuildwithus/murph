---
title: 'open-exec-plan treats --help as a plan name'
severity: 'minor'
---

## Expected Behavior

`scripts/open-exec-plan.sh --help` should print usage and exit without changing the worktree.

## Current Behavior

The command creates an active execution-plan file whose slug is `--help`.

## Possible Solution

Reserve `-h` and `--help` in the wrapper or underlying CLI before slug creation.

## Minimal Reproducible Example

1. Start from a clean synthetic checkout.
2. Run `scripts/open-exec-plan.sh --help`.
3. Observe a new active plan instead of usage output.

## Context

This makes safe command discovery mutate the repository and requires cleanup before task work can continue.
