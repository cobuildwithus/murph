---
title: 'Live assistant runner reports an unreadable focused-test list when pnpm prints engine warnings'
severity: 'minor'
---

## Expected Behavior

`pnpm test:assistant:live -- --test "<one test name>"` lists the single focused journey and runs it, or fails with a message that names the real cause.

## Current Behavior

When the active Node is older than the repo's `engines.node`, pnpm writes "Unsupported engine" warnings to stdout before the `vitest list --json` output. The runner then fails with "Vitest returned an unreadable focused-test list." for every pattern, which reads like a bad test name.

## Possible Solution

Parse only the JSON array from the list output, or run the list step with pnpm's engine warnings silenced, and mention the Node version in the error.

## Minimal Reproducible Example

1. Put a Node older than `.nvmrc` first on PATH.
2. Run `pnpm test:assistant:live -- --test "<exact existing live test name>"`.
3. Observe the unreadable focused-test list error; the same `vitest list --json` command run directly prints a valid array.

## Context

Hit while running new game-chat live journeys. Switching PATH to the `.nvmrc` Node fixed it.
