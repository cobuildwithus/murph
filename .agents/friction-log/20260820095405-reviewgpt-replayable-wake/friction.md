---
title: 'ReviewGPT replayable wake command points to missing global binary'
severity: 'minor'
---

## Expected Behavior

The replayable wake command printed after a response-capture failure should invoke a ReviewGPT binary that exists in the repository environment, so the accepted thread can be recovered without resending.

## Current Behavior

The printed command resolved to a stale global pnpm shim whose package binary no longer existed. Running it failed immediately with a missing-file error. Recovery required replacing the printed executable with the repository-local `pnpm exec cobuild-review-gpt` command before the tool could perform its exact-target check.

## Possible Solution

Emit a repository-local wake command, or persist and print the exact executable path used by the successful ReviewGPT invocation instead of resolving a global shim at recovery time.

## Minimal Reproducible Example

1. Run a waited ReviewGPT audit until prompt submission succeeds but response capture cannot finish.
2. Copy the emitted replayable `cobuild-review-gpt thread wake` command.
3. Run it from the same task worktree.
4. Observe the command fail before recovery because its global package binary is missing.
5. Prefix the same arguments with `pnpm exec` and observe the repository-local binary run the recovery check.

## Context

The invalid recovery command delayed a mandatory exact-head audit and risked turning a recoverable accepted thread into a duplicate-send retry. The recovery itself still failed closed for a separate already-recorded missing-target condition.
