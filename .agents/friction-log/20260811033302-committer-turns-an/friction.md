---
title: 'Committer turns an active merge into a one-parent commit and leaves MERGE_HEAD open'
severity: 'major'
issue: 'cobuildwithus/murph#1666'
---

## Expected Behavior

The repository committer wrapper should preserve an active merge and create one commit with both merge parents, or stop before creating any commit when merge commits are unsupported.

## Current Behavior

When invoked with every staged path during an active merge, the wrapper creates a regular one-parent commit from the resolved index but leaves MERGE_HEAD active. A subsequent native commit is required to conclude the merge, producing an extra no-op merge commit.

## Possible Solution

Detect MERGE_HEAD and either delegate to the ordinary merge-aware commit path or reject the operation with the supported command. Add a regression test that asserts the final commit has both expected parents and no merge state remains.

## Minimal Reproducible Example

1. Start a non-fast-forward merge in a clean task worktree and resolve all conflicts.
2. Stage every resolved path.
3. Invoke the repository committer wrapper with the staged path list.
4. Inspect the new commit and observe one parent.
5. Observe that MERGE_HEAD still exists and another commit is required to finish the merge.

## Context

This complicates mechanical base reconciliation, creates misleading history, and forces a native commit workaround after the repository wrapper reports success.
