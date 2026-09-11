---
title: 'Linq audio retry fixture expires against pending-input retention'
severity: 'minor'
issue: 'cobuildwithus/murph#3115'
---

## Expected Behavior

The audio parser abort-and-retry test should exercise mailbox progress and eventual input selection independently of the calendar date.

## Current Behavior

Its fixed event timestamp crosses the 14-day pending-input content retention window. Background input selection correctly retires the expired fixture, causing required platform-a coverage to fail with an empty selection.

## Possible Solution

Use a current synthetic event timestamp for this retry fixture while preserving production retention behavior and all retry assertions.

## Minimal Reproducible Example

After 2026-09-09T17:22:20Z, run `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --isolate=true --no-coverage packages/assistant-runtime/test/hosted-runtime-linq-audio-e2e.test.ts`. The parser-drain abort test fails its settled selection assertion. Changing only that fixture's occurredAt to the current time restores the intended scenario.

## Context

An unrelated metadata-only telemetry PR encountered this failure in required release coverage. The failure was reproduced locally before changing the fixture.
