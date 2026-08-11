---
title: 'Pre-commit schema generation fails on a base-only merge in a fresh worktree'
severity: 'minor'
---

## Expected Behavior

A merge commit whose CLI changes come only from the current base should either complete the config-schema hook successfully or report a bounded diagnostic and supported recovery command.

## Current Behavior

The hook treats staged CLI paths from the base merge as task-authored changes and launches the package-local schema generator. In a fresh worktree, that generator builds the CLI before required workspace package outputs exist, fails on unresolved workspace modules, suppresses the diagnostic, and continues with only a generic warning that CI will verify the result.

## Possible Solution

Make the hook use a workspace-aware prerequisite build or surface the first actionable failure and recovery command. Consider whether base-only merge changes should trigger task-owned regeneration.

## Minimal Reproducible Example

1. Create a clean task worktree and install the frozen workspace dependencies.
2. Merge a newer default branch revision that includes staged CLI package changes.
3. Commit the merge.
4. Observe the generic config-schema warning.
5. Run the package config-schema generator directly and observe that its CLI build cannot resolve unbuilt workspace package outputs.

## Context

This adds diagnosis time to otherwise mechanical merge-boundary conflict resolution and makes it unclear whether the task branch produced stale generated artifacts.
