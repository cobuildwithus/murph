---
title: 'Commit preparation rejects a Git index stat-cache refresh'
severity: 'minor'
---

## Expected Behavior

A read-only status check during scoped commit preparation should not look like a concurrent staged-content change.

## Current Behavior

The committer compares the real index and its initial snapshot byte-for-byte before reconciliation. A normal git status can refresh index stat metadata without changing staged blobs, causing the commit to fail after preparation. The observed failure was `repository index changed during commit preparation; no commit was created` with no staged-content changes.

## Possible Solution

Distinguish staged tree or index-entry changes from stat-cache-only updates while retaining the index lock and conflict protection. Document GIT_OPTIONAL_LOCKS=0 for concurrent diagnostic commands.

## Minimal Reproducible Example

Start scripts/committer on a large untracked asset set. During preparation, run ordinary git status after file stats change. Compare staged entries before and after and observe that only index cache metadata changed.

## Context

The workaround is to avoid Git commands that refresh the real index while the scoped committer runs. The failed attempt did not create a commit or alter staged content.
