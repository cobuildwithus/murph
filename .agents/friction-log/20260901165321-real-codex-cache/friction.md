---
title: 'Real-Codex cache probe fails before focused assistant journeys start'
severity: 'minor'
issue: 'cobuildwithus/murph#2695'
---

## Expected Behavior

A focused real-Codex journey should complete its cache probe and run the selected synthetic test so assistant reply behavior can be reviewed.

## Current Behavior

Two consecutive focused runs failed during the pre-turn cache probe with a generic assistant failure, zero provider actions, and no reported token usage. The selected journey never started, so its user-visible reply could not be inspected.

## Possible Solution

Surface the cache-probe provider failure class and retryability separately from the selected journey, and allow a bounded retry that does not consume the journey result.

## Minimal Reproducible Example

1. Run a single focused real-Codex assistant journey through the repository live-test command.
2. Observe the cache probe fail before the selected test produces any assistant action.
3. Retry once and observe the same pre-turn failure with no model usage.

## Context

This blocks the required real-Codex reply review even when deterministic runtime tests and typecheck pass.
