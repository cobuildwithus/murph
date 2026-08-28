---
title: 'Storage guard cannot read filesystem capacity during scoped commits'
severity: 'major'
---

## Expected Behavior

The sanctioned scoped-commit path should install or verify hooks and complete when the checkout has sufficient storage. Capacity probing should either return a concrete result or report a bounded actionable failure without consuming the full hook-install wait.

## Current Behavior

The scoped committer waited on the storage-guard lock, then failed because the guard could not read filesystem capacity. No Git commit was attempted, and the incident candidate remained uncommitted despite an otherwise healthy checkout and completed verification.

## Possible Solution

Make the capacity probe robust to the supported local filesystem output and expose the failing probe command or normalized error. Preserve the fail-closed storage threshold and serialized guard ownership.

## Minimal Reproducible Example

1. Prepare a verified scoped diff in an authorized task worktree.
2. Run the repository scoped-commit helper with the intended paths.
3. Observe hook installation wait for the storage guard and then report that filesystem capacity could not be read.
4. Confirm that no commit was created.

## Context

This blocked the review-candidate commit for a production runtime recovery and forced a retry of the same sanctioned commit path.
