---
title: 'Removing a temporary workspace dependency rewrites unrelated lockfile peers'
severity: 'minor'
---

## Expected Behavior

Adding and then removing an exact development dependency should restore the committed dependency graph without changing unrelated peer-resolution snapshots.

## Current Behavior

Running the workspace package-manager remove command after evaluating a temporary CLI dependency rewrites unrelated peer-resolution entries even though the dependency is absent from the final package manifest. The task must restore those unrelated lockfile hunks before commit.

## Possible Solution

Provide a documented evaluation workflow that can add and remove a temporary dependency without re-resolving unrelated peers, or make the package-manager command preserve the committed peer-resolution choices when the manifest returns to its original state.

## Minimal Reproducible Example

1. Start from a clean worktree with a frozen install.
2. Add an exact development-only CLI dependency to one workspace.
3. Remove the same dependency.
4. Observe that the workspace manifest is restored while unrelated peer variants remain changed in the lockfile.

## Context

This adds review noise and creates a supply-chain diff unrelated to the requested workflow-only tool evaluation.
