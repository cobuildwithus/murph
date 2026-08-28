---
title: 'Orphaned workspace artifact locks block delegated verification indefinitely'
severity: 'minor'
issue: 'cobuildwithus/murph#2495'
---

## Expected Behavior

Delegated verification should either acquire the candidate-capture lock, prove the active owner is live, or fail within a bounded interval with an actionable recovery path.

## Current Behavior

A verification process whose parent had exited retained the workspace artifact lock for more than a day. A later canonical test:diff invocation remained at waiting-for-workspace-lock, so the requested isolated executor never started. Process-ownership safety correctly prevented the later session from signaling the ambiguous owner.

## Possible Solution

Associate the lock with liveness metadata that the wrapper can validate, and add a bounded fail-closed timeout that reports the proven owner state without bypassing the lock.

## Minimal Reproducible Example

1. Start canonical delegated verification.
2. Let the parent session exit while its verification wrapper remains alive.
3. Start canonical delegated verification from a separate clean task worktree.
4. Observe that candidate capture waits indefinitely instead of proving liveness or returning a bounded recovery error.

## Context

This blocks secret-free isolated completion checks and forces work back onto a saturated shared host.
