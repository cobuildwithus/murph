---
title: 'CLI test commits trigger an unprepared config-schema build'
severity: 'minor'
---

## Expected Behavior

Committing a CLI test-only change either skips config-schema generation or prepares the workspace dependencies required by that generator.

## Current Behavior

The pre-commit hook treats every packages/cli change as a config-schema input. In a fresh sanctioned worktree, it runs the generator, which invokes the CLI package build before dependent workspace package artifacts exist. TypeScript reports many missing workspace entrypoints, the hook prints a generation-failed warning, and then deliberately continues.

## Possible Solution

Narrow the generator trigger to actual schema inputs, or route the hook through the existing prepared-runtime owner before building the CLI.

## Minimal Reproducible Example

1. Create a fresh sanctioned task worktree and install dependencies.
2. Change only a test under packages/cli/test.
3. Commit through scripts/committer.
4. Observe config-schema generation attempt an unprepared standalone CLI build and then continue after failure.

## Context

This does not invalidate the commit because the hook is explicitly fail-open to CI, but it creates noisy false-negative local feedback for unrelated CLI test changes.
