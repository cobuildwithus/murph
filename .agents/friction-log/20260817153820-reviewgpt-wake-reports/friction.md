---
title: 'ReviewGPT wake reports failure while its child keeps editing'
severity: 'minor'
---

## Expected Behavior

When thread wake reports that its Codex child failed to launch, no child process should remain able to edit the task worktree. If the child did launch, wake should report and supervise that state accurately.

## Current Behavior

Thread wake can time out waiting for child launch events, exit with a launch-failure error, and leave the spawned Codex process running. The orphaned child can then edit the same worktree concurrently with the parent that is recovering from the reported failure.

## Possible Solution

Track the spawned child process independently of launch-event delivery. Before returning a launch failure, terminate and reap the exact owned child tree, or return a structured running-child state that prevents the parent from resuming edits concurrently.

## Minimal Reproducible Example

1. Export a completed synthetic review thread with no attachment.
2. Let thread wake launch its normal Codex child while suppressing or delaying child launch events past the acknowledgement timeout.
3. Observe wake return a launch-failure error.
4. Observe the spawned child continue running and modify the task worktree.

## Context

The misleading terminal state creates a shared-worktree race during mandatory review remediation and can invalidate focused reproductions while the parent believes the handoff never started.
