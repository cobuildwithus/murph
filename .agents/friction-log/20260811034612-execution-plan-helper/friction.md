---
title: 'Execution-plan helper treats --help as a plan title'
severity: 'minor'
---

## Expected Behavior

Running the execution-plan helper with `--help` should print usage without changing the working tree.

## Current Behavior

The helper creates an active execution-plan file whose title is `--help`.

## Possible Solution

Handle standard help flags before forwarding the title to the plan generator.

## Minimal Reproducible Example

1. Start from a clean task worktree.
2. Run `scripts/open-exec-plan.sh --help`.
3. Observe a new active plan file instead of usage output.

## Context

This creates task-owned cleanup work before a correctly named plan can be opened.
