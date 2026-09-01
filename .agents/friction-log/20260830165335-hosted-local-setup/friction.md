---
title: 'Hosted-local setup timeout leaves owned child processes running'
severity: 'minor'
issue: 'cobuildwithus/murph#2624'
---

## Expected Behavior

When a hosted-local Vitest `beforeAll` hook times out or its parent E2E process exits, every child process started by that scenario should stop before the command returns.

## Current Behavior

A timed-out hosted-local full-stack scenario can return while its Caddy, Wrangler, workerd, or generated-artifact child processes continue running. A later retry then competes with those abandoned processes and requires exact-PID cleanup after ownership is proved.

## Possible Solution

Make the scenario launcher retain process ownership before setup completes and always run its bounded teardown path on hook timeout, parent exit, and interrupted setup.

## Minimal Reproducible Example

1. Run one hosted-local full-stack E2E scenario from a clean task worktree.
2. Let stack setup exceed the test hook timeout before the scenario object is returned.
3. Observe that the test command exits but worktree-scoped child processes remain active.

## Context

This delayed focused verification and made a retry less reliable. The product behavior under test was never reached.
