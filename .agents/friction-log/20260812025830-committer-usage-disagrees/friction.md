---
title: 'Committer usage disagrees with repository examples'
severity: 'minor'
issue: 'cobuildwithus/murph#1753'
---

## Expected Behavior

The commit wrapper should accept the invocation form shown by repository tests and guidance, or those examples should use its positional-message interface.

## Current Behavior

The wrapper rejects the example -m form as an unknown option while its usage requires a positional commit message.

## Possible Solution

Align the wrapper parser and repository examples around one supported interface.

## Minimal Reproducible Example

From a sanctioned task worktree, invoke scripts/committer with -m, a synthetic message, and one scoped path.

## Context

The mismatch interrupts the required scoped intermediate-commit workflow and requires an avoidable retry.
