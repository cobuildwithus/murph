---
title: 'Repo-tool shard makes worktree guard tests exceed fixed timeouts'
severity: 'minor'
---

## Expected Behavior

The repository-tool verification shard should give process-heavy worktree-storage tests enough isolated capacity to complete within their declared timeouts.

## Current Behavior

When the full repository-tool shard runs, several worktree-storage guard tests exceed fixed 15-second limits. The same complete test file passes when run alone, showing the failures come from broad-shard contention rather than the tested behavior.

## Possible Solution

Place the process-heavy worktree-storage tests in a serial or separately budgeted verification bucket instead of competing with the rest of the repository-tool suite.

## Minimal Reproducible Example

1. Run the diff-aware verification lane for a repository-tool change.
2. Observe worktree-storage process tests time out in the broad repository-tool shard.
3. Run the worktree-storage guard test file alone.
4. Observe every test pass without source changes.

## Context

The broad lane ran hundreds of unrelated tests before reporting timing failures, while the isolated file completed successfully. This delays scoped repository-tool verification and obscures whether a changed surface is actually broken.
