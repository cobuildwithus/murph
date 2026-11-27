---
title: 'Thumbnail checkpoint stress test exceeds the shared-host timeout'
severity: 'minor'
issue: 'cobuildwithus/murph#4964'
---

## Expected Behavior

The assistant-runtime package suite should complete its thumbnail checkpoint stress proof within the standard test timeout when using the documented shared-host worker budget.

## Current Behavior

The existing test `dedicated wakes give 32 healthy thumbnails a delivery turn before charging their attempts` failed after about 60 seconds during a full package run alongside the assistant-engine suite. The same unchanged test passed alone with a 36-second test body. Its repeated checkpoint/archive/restore loop is close enough to the default timeout to make broad verification timing-sensitive.

## Possible Solution

Keep the 32-thumbnail fairness assertion, but reduce repeated fixture and archive work where the proof permits, or give this explicitly heavy synthetic journey a documented bounded timeout appropriate to its work.

## Minimal Reproducible Example

Prepare artifacts with `pnpm build:test-runtime:prepared`. Run assistant-engine and assistant-runtime package Vitest suites concurrently using their normal shared-host budgets. Inspect `packages/assistant-runtime/test/hosted-invocation-bridge.test.ts`. If the stress case times out, rerun that named case alone without changing its assertions or timeout.

## Context

This adds noise and a focused rerun to otherwise unrelated device-source verification. No product behavior or test timeout was changed for this task.
