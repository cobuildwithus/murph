---
title: 'pnpm patch-commit rewrites unrelated peer dependency snapshots'
severity: 'minor'
issue: 'cobuildwithus/murph#2685'
---

## Expected Behavior

Committing one dependency patch changes only that patch registration, its hash, and the dependency entries affected by the patched package.

## Current Behavior

Running pnpm patch-commit for one dependency also rewrites unrelated ESLint peer-dependency snapshot keys in pnpm-lock.yaml. The unrelated churn must be identified and restored manually before the frozen install can provide a reviewable lockfile.

## Possible Solution

Add a repository wrapper or focused lockfile guard that preserves unrelated peer snapshots when committing a dependency patch.

## Minimal Reproducible Example

1. Run pnpm patch for an already registered patched dependency into a temporary edit directory.
2. Make a small source and distribution change.
3. Run pnpm patch-commit for that directory.
4. Inspect pnpm-lock.yaml and observe unrelated ESLint peer snapshot rewrites.

## Context

This makes dependency patch maintenance noisier and can hide the intended production graph change during review.
