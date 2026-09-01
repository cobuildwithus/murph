---
title: 'Automation-supplied task worktree cannot pass repository commit authorization'
severity: 'minor'
issue: 'cobuildwithus/murph#2662'
---

## Expected Behavior

An isolated Murph task worktree supplied to an automation under the configured
Codex worktree root should either be created through `scripts/create-worktree`
or carry repository-verifiable authorization that lets the normal hook and
committer run.

## Current Behavior

The supplied clean worktree can fetch, branch, install dependencies, edit, and
run focused verification, but both dependency prepare and the commit wrapper
fail closed because the current worktree bypassed `scripts/create-worktree`.
The completed task cannot be committed or pushed without bypassing a mandatory
repository guard.

## Possible Solution

Route automation task-worktree creation through `scripts/create-worktree`, or
add a repository-owned handoff that validates and sanctions an already-created
Codex worktree without weakening the global raw-worktree audit.

## Minimal Reproducible Example

1. Supply an automation a clean registered worktree created outside
   `scripts/create-worktree`.
2. Create a task branch and a synthetic tracked change.
3. Run the normal dependency prepare or scoped committer.
4. Observe the fail-closed worktree-bypass error before commit.

## Context

This blocks a production-bug task after its focused patch and tests are ready,
while correctly preventing a hook bypass. The automation needs a sanctioned
creation or handoff path so repository completion can remain fail closed.
