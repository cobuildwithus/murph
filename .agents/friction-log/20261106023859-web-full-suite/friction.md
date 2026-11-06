---
title: 'Web full suite leaves an untracked SWC plugin cache'
severity: 'minor'
---

## Expected Behavior

Running the declared Web test suite leaves only intentional source changes in the Git worktree.

## Current Behavior

The suite creates a binary plugin cache under `.swc/plugins/` at the repository root. Git reports this build residue as untracked, so scoped commit preparation requires identifying and removing it.

## Possible Solution

Route the compiler cache to the existing ignored test cache owner, or explicitly classify this generated directory in the repository ignore policy.

## Minimal Reproducible Example

Run `pnpm --dir apps/web test`, then inspect `git status --short` for `.swc/`.

## Context

Observed while running the full downstream consumer suites for the photo descriptor preserver. No cache content belongs in the task commit.
