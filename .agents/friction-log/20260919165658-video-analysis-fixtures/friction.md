---
title: 'Video analysis fixtures expire against the real clock'
severity: 'minor'
---

## Expected Behavior

The isolated video-tool suite should keep synthetic attachment authority valid while proving selection, privacy scope, provider results and timeout handling.

## Current Behavior

The fixture fixes receivedAt to 2026-08-20 but evaluates authority against Date.now(). Once the 30-day video-retention window passes, previously valid clips disappear before provider execution. This causes 25 assertion failures, including a timeout test that waits for a provider request that can never start. A separate turn-planning snapshot failure is unrelated to this fixture issue.

## Possible Solution

Pin only Date to the fixture day for this suite and restore timers afterward. Keep the provider-timeout test's explicit fake-timer control. Do not relax production retention or attachment authority.

## Minimal Reproducible Example

After the synthetic fixture's retention deadline, run `pnpm --dir packages/assistant-engine test test/assistant-codex-analyze-video-tool.test.ts -t "loads one accepted video and makes one fixed-shape provider request"`. It fails because the selected attachment is no longer retained. The failure also reproduces with the original unchanged video owner and the base dynamic-tool catalog.

## Context

This prevents unrelated assistant-engine changes from completing coverage verification. The inputs and dates above are synthetic test fixtures, not production records.
