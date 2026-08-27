---
title: 'finish-task fails after archiving a staged active plan'
severity: 'minor'
---

## Expected Behavior

finish-task should archive and commit an active execution plan whether or not that plan was already staged with the candidate.

## Current Behavior

When the active plan is already staged, finish-task moves it to the completed directory and then fails while trying to stage the now-missing active path. The task commit is not created, and the checkout is left with a staged addition/deletion plus an untracked completed plan.

## Possible Solution

Stage the archive as an explicit old-path/new-path pair, or use a path-scoped all-state add that accepts the source disappearing during the archive.

## Minimal Reproducible Example

1. Create an active execution plan.
2. Stage the active plan with the task candidate.
3. Run finish-task for that plan and the scoped task paths.
4. Observe that the plan is moved but the commit stops before creation.

## Context

Remote candidate verification requires fully staged new files. A plan-bearing task therefore needs finish-task to accept an already-staged active plan without leaving partial archival state.
