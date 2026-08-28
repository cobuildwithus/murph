---
title: 'Concurrent hosted Web checks race the health-commons generated-directory swap'
severity: 'minor'
---

## Expected Behavior

Independent hosted Web verification commands can run concurrently, or the shared generator serializes its atomic replacement safely.

## Current Behavior

When two hosted Web checks invoke health-commons generation at the same time, one can fail with an ENOTEMPTY rename error while replacing the shared generated directory.

## Possible Solution

Serialize the generator final directory replacement or let callers reuse one prepared generation step.

## Minimal Reproducible Example

From one worktree, start the hosted Web changelog test and hosted Web typecheck concurrently. Both invoke health-commons generation; one can fail during the temporary-directory rename.

## Context

This blocks otherwise independent verification from running in parallel and requires a clean sequential retry. No product code is involved.
