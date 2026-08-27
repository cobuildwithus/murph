---
title: 'ReviewGPT preflight cannot package a fresh task worktree'
severity: 'minor'
---

## Expected Behavior

A task worktree created by the repository helper can run the repository ReviewGPT entrypoint with the reviewed workspace toolchain.

## Current Behavior

A fresh task worktree has no dependency links, so the ReviewGPT preflight reaches the repository no-JavaScript guard and fails because the TypeScript runner is unavailable. Completing the review then requires either coupling the command to another checkout installation or installing the full workspace dependency graph.

## Possible Solution

Have the sanctioned worktree helper expose the primary checkout reviewed dependency installation safely, or make the ReviewGPT wrapper resolve its required repository tools through an explicit supported owner.

## Minimal Reproducible Example

1. Create a task worktree with scripts/create-worktree from a current branch.
2. Enter the new worktree without installing dependencies.
3. Run pnpm review:gpt --zip --dry-run.
4. Observe the preflight fail before packaging because the TypeScript runner cannot be found.

## Context

This blocks the required exact-head ReviewGPT workflow in isolated task branches and makes a repository-wide frozen install the smallest independent recovery.
