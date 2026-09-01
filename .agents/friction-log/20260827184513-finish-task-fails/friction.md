---
title: 'finish-task fails after archiving a pre-staged active plan'
severity: 'minor'
issue: 'cobuildwithus/murph#2516'
---

## Expected Behavior

`scripts/finish-task` should archive an active execution plan and create the scoped task commit even when the new plan file was staged before the helper ran.

## Current Behavior

The helper moves the active plan to `completed/`, then treats the missing active path as tracked because it remains staged in the index. `scripts/committer` receives both paths and fails because the active path no longer exists. The task is left with an archived untracked plan and an add/delete index entry that requires manual recovery.

## Possible Solution

Resolve the plan paths from the worktree after archiving, or stage the move before testing whether the former active path still needs to be passed to `scripts/committer`.

## Minimal Reproducible Example

1. Create a new active execution plan.
2. Stage that plan.
3. Run `scripts/finish-task <active-plan> "test commit" <changed-file>`.
4. Observe that the plan is moved and the commit fails on the missing active path.

## Context

This blocks the repository-required completion helper after all task verification has already passed and forces a manual index recovery before the scoped commit can be created.
