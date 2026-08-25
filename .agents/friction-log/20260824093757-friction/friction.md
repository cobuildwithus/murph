---
title: 'finish-task rejects intentionally deleted task paths'
severity: 'minor'
issue: 'cobuildwithus/murph#2222'
---

## Expected Behavior

When a task intentionally deletes an obsolete file, finish-task should accept that deleted path as part of the scoped task, archive the active plan, and create the final commit.

## Current Behavior

The helper requires every supplied task path to exist in the working tree and aborts with Commit path not found for an intentionally deleted file, even when that deletion is already part of the branch diff.

## Possible Solution

Accept tracked deletion paths that are proven by the base-to-head diff, or document and automatically filter the task path list to surviving paths before the final scoped commit.

## Minimal Reproducible Example

1. Delete path/to/obsolete.md on a task branch and commit the deletion.
2. Update the active execution plan.
3. Run scripts/finish-task with path/to/obsolete.md among the scoped task paths.
4. Observe that finalization aborts because the intentionally deleted path no longer exists.

## Context

Deletion-first work commonly removes obsolete policy or architecture files, so this forces callers to manually exclude a legitimate part of the resolved task diff during plan closure.
