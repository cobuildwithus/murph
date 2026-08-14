---
title: 'Worktree Spotlight exclusion is installed after checkout population'
severity: 'minor'
---

## Expected Behavior

A sanctioned worktree should be excluded from Spotlight before Git materializes tracked checkout files.

## Current Behavior

The creation helper completes git worktree add and writes .metadata_never_index afterward, allowing the initial checkout population to enter the Spotlight indexing queue.

## Possible Solution

Register the worktree without checkout, validate and authorize it, write the exclusion marker, and then materialize the checkout.

## Minimal Reproducible Example

Create a repository whose required smudge filter fails unless .metadata_never_index already exists, then create a linked worktree through scripts/create-worktree. The current helper invokes the filter before writing the marker.

## Context

Large repositories and concurrent task worktrees can create avoidable metadata-indexing work during initial checkout.
