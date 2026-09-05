---
title: 'retire-worktree partial removal leaves quarantined checkout dirty'
severity: 'minor'
---

## Expected Behavior

`scripts/retire-worktree` should either retire an eligible clean checkout completely or leave it clean and retryable when non-force removal fails.

## Current Behavior

After all preflight gates passed, the helper moved the checkout into its `.retiring-<sha>` quarantine path. Its suppressed `git worktree remove` failure partially removed tracked files before the helper stopped. The registered checkout then appeared dirty, so rerunning the required helper was rejected and the deleted files had to be restored from the already-proven clean HEAD.

## Possible Solution

Capture and report the underlying non-force removal error, and make the quarantined state recoverable without requiring a force removal. One option is to validate that removal can complete before the move; another is a dedicated resume path that safely recognizes and restores or completes a helper-created quarantine.

## Minimal Reproducible Example

1. Start with a clean inactive task worktree whose exact PR head is closed.
2. Run `scripts/retire-worktree <task-worktree>`.
3. Cause the non-force `git worktree remove` boundary to fail after recursive removal begins.
4. Observe that the worktree remains registered under `.retiring-<sha>` with tracked deletions and that a retry is rejected as dirty.

## Context

This blocks the repository-required worktree retirement step after a task is terminal. The helper suppresses the removal error that would identify the filesystem cause, while its own partial deletion makes the supported command non-idempotent.
