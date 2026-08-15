---
title: 'ReviewGPT handoff wake expires before the repo response timeout'
severity: 'minor'
---

## Expected Behavior

ReviewGPT implementation handoff polling should default to the same 180-minute window as repo response capture unless a caller explicitly overrides it.

## Current Behavior

The repo response capture defaults to 180 minutes, but agents can invoke thread wake with a 120-minute poll timeout. A still-busy Pro task then exits before the repo-standard response window ends.

## Possible Solution

Make 180 minutes the standing repo default for thread wake polling and preserve explicit per-run overrides.

## Minimal Reproducible Example

1. Start a synthetic ReviewGPT implementation request that remains busy beyond 120 minutes.
2. Poll it with thread wake and a 120-minute timeout.
3. Observe the wake exit while the thread is still marked busy.

## Context

This can discard the active handoff wait before a long-running implementation response returns its attachment.
