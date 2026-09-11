---
title: 'Dependency installation fails when the shared worktree hook lock is busy'
severity: 'minor'
issue: 'cobuildwithus/murph#3183'
---

## Expected Behavior

A frozen dependency install in an already-created worktree should finish when another checkout is performing guarded worktree maintenance.

## Current Behavior

The prepare lifecycle waits 180 seconds in install-git-hooks and then fails with exit 75 when the shared storage guard is busy, even after all dependency packages have been installed. New guarded worktree creation also fails immediately while that lock is held.

## Minimal Reproducible Example

Run guarded worktree maintenance concurrently with pnpm install --frozen-lockfile in another existing worktree; keep maintenance active longer than the hook installation timeout.

## Context

This blocks independent scoped PR setup. No lock removal or process termination is needed to reproduce it.
