---
title: 'finish-task retains archived active-plan path from directory expansion'
severity: 'minor'
---

## Expected Behavior

When a task directory argument contains the active plan, `finish-task` should archive the plan and commit the archived path plus the other resolved task files.

## Current Behavior

The helper expands the directory before archiving, retains the active plan in its resolved path list, moves that plan to `completed/`, and then passes the deleted active path to the committer. The committer rejects the missing file, leaving the task changes and safely archived plan uncommitted.

## Possible Solution

After archiving, replace the active plan in the resolved path list with the completed plan path or exclude the active plan from directory expansion because the wrapper already owns both plan paths.

## Minimal Reproducible Example

1. Create an untracked active execution plan and edit another file under the same parent task directory.
2. Run `scripts/finish-task` with that parent directory as one of its scoped paths.
3. Observe that plan archival succeeds and commit creation fails because the old active plan path no longer exists.

## Context

This forces a second scoped commit command after the required finalization helper has already moved the plan.
