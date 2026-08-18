---
title: 'Required committer wrapper rejects merge commits'
severity: 'minor'
---

## Expected Behavior

The required scoped commit workflow should provide a supported way to finish a staged base-reconciliation merge, or explicitly document the ordinary Git merge-commit exception.

## Current Behavior

`scripts/committer` exits when `MERGE_HEAD` exists and tells the caller to finish or abort the merge, while the repository workflow otherwise requires the wrapper for no-plan repository commits.

## Possible Solution

Allow the wrapper to validate and finish an active merge, provide a dedicated merge-commit wrapper, or document the narrow direct-commit exception.

## Minimal Reproducible Example

1. Start a normal base merge that produces one conflict.
2. Resolve and stage the conflict.
3. Invoke `scripts/committer` with the staged paths.
4. Observe that it rejects the active merge before committing.

## Context

This blocks the documented scoped-wrapper path during ordinary PR base reconciliation and forces callers to discover an unstated commit path.
