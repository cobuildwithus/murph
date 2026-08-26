---
title: 'ReviewGPT detached wake rejects its emitted capture identity'
severity: 'minor'
---

## Expected Behavior

A detached ReviewGPT wake created from the exact response capture metadata should resume the owning session after the already-sent review completes.

## Current Behavior

The foreground waiter emits capture metadata and says the committed-turn identity was persisted for wake recovery. A detached watcher using that metadata retries, then fails because the identity resolves to zero turns. The already-sent review remains unharvested and requires a separate exact-thread recovery path.

## Possible Solution

Validate the persisted committed-turn selector before advertising the replayable wake command, or make wake resolve the exact staged prompt and attachment identity recorded by the sender.

## Minimal Reproducible Example

1. Send a guarded PR review with response capture enabled.
2. Stop only the owned foreground waiter after the prompt is accepted.
3. Start `thread wake` with the emitted capture metadata and exact managed browser lane.
4. Observe the watcher fail because the committed user-turn identity resolves to zero turns.

## Context

This blocks the documented handoff from a long-running foreground review to its detached completion owner during a PR completion loop.
