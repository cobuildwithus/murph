---
title: 'Concurrent ReviewGPT packagers share a removable PR context directory'
severity: 'minor'
---

## Expected Behavior

The preliminary and final ReviewGPT packagers should build independent exact-head context directories when the repository runs them concurrently.

## Current Behavior

Both packagers use the same review-gpt-pr-context directory. One invocation can remove it while the other is still writing, causing the second run to fail before staging because a required PR context file disappeared.

## Possible Solution

Build the PR context under an invocation-owned temporary directory and copy that directory into the matching audit bundle before cleanup.

## Minimal Reproducible Example

1. Start the preliminary completion-specialists pass and final PR-review round concurrently for one clean pushed head.
2. Allow both packaging commands to create their PR context.
3. Observe one cleanup remove the shared directory while the other invocation is still writing it.

## Context

The completion workflow explicitly permits these independent passes to run concurrently, so their packaging state must not share a cleanup boundary.
