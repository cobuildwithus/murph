---
title: 'Narrowed shared fetch rules leave origin main stale during merge preparation'
severity: 'minor'
issue: 'cobuildwithus/murph#3119'
---

## Expected Behavior

Merge preparation should compare the PR candidate with the actual current remote main commit across all task worktrees.

## Current Behavior

A narrowed shared `remote.origin.fetch` mapping can track only a task branch. Under that mapping, `git fetch origin main` updates `FETCH_HEAD` but leaves `origin/main` stale. A subsequent merge-tree check against `origin/main` can pass while GitHub correctly reports a conflict against a newer main commit.

## Possible Solution

Use an explicit destination refspec when refreshing the merge base, and verify the resulting remote-tracking ref against the fetched or remote head. Preserve other tasks' shared fetch settings.

## Minimal Reproducible Example

In an isolated synthetic repository, configure the origin fetch mapping for only `refs/heads/example-task`. Advance remote main, then run `git fetch origin main` and compare `git rev-parse FETCH_HEAD` with `git rev-parse origin/main`. Refresh explicitly with `git fetch origin refs/heads/main:refs/remotes/origin/main` before mergeability proof.

## Context

A PR merge needed a second normal base reconciliation after the narrow fetch left the first local mergeability proof pointed at old main. The mismatch was confirmed against GitHub's base SHA and `git ls-remote`; the explicit destination refresh exposed the remaining documentation conflict without changing shared Git configuration.
