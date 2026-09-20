---
title: 'Video analysis fixtures expire against the wall clock'
severity: 'minor'
---

## Expected Behavior

Video-tool tests should continue to exercise provider and authority boundaries independently of the calendar date.

## Current Behavior

The suite dates accepted attachments to August 20, 2026 but snapshots authority using the real clock. After the 30-day video retention window, 25 tests fail because their supposedly retained attachment authority is empty. This blocks unrelated release package CI.

## Possible Solution

Pin the suite's Date clock to its existing fixture date while leaving ordinary timers real; retain explicit fake timers for the timeout case. Production retention remains unchanged.

## Minimal Reproducible Example

Run `pnpm --filter @murphai/assistant-engine test test/assistant-codex-analyze-video-tool.test.ts` with a system date after September 19, 2026.

## Context

Observed in the release assistant-engine coverage shard while verifying additive authentication retirement preparation.
