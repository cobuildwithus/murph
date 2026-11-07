---
title: 'Scoped committer has no amend mode for an owned local commit'
severity: 'minor'
issue: 'cobuildwithus/murph#4716'
---

## Expected Behavior

The scoped commit wrapper should support amending an existing owned local commit while preserving its message, trailer, and exact file scope.

## Current Behavior

`scripts/committer` only creates a new child commit. Its CLI and implementation expose no amend option, so a task that requires both the wrapper and `git commit --amend` needs a temporary child commit followed by a soft reset and amendment.

## Minimal Reproducible Example

Read `scripts/committer --help` and the installed `@cobuild/repo-tools/src/committer.sh`. The wrapper selects HEAD as its parent and always creates a new child.

## Context

The final branch must retain one scoped local commit. No push or shared-history rewrite is required.
