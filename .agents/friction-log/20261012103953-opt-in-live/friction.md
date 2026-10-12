---
title: 'Opt-in live freshness journey drifted from the host read request shape'
severity: 'minor'
---

## Expected Behavior

Opt-in real-Codex journeys stay current with the production host request shape, so a focused run proves behavior, not stale fixture assertions.

## Current Behavior

`handles wearable freshness recovery in a scheduled group update` asserted the shared read request with `toEqual` and no `includeCompanionPresence` field. The host now always sends `includeCompanionPresence: true`, so every scenario failed before its reply assertions ran. Routine CI compiles but does not run the live journey, so the drift went unnoticed.

## Possible Solution

Assert host-owned request fields through one shared helper, or add a deterministic test that drives the same fixture through the scripted provider so request-shape drift fails in CI.

## Minimal Reproducible Example

Run `pnpm test:assistant:live -- --test "handles wearable freshness recovery in a scheduled group update: missing"` on a main checkout from 2026-10-12.

## Context

Found while re-running affected group wearable journeys for a group prompt change.
