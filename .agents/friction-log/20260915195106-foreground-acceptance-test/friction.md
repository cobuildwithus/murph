---
title: 'Foreground acceptance test counts telemetry retries as new events'
severity: 'minor'
---

## Expected Behavior

The foreground acceptance regression should prove logical acceptance milestones and reply progress independently of best-effort telemetry transport retries.

## Current Behavior

The test deliberately throws from the latency trace port, then counts every record attempt as a new acceptance event. The sender retries the same request after a delay, so the test passes when fast and fails when CI observes retry attempts.

## Possible Solution

Count each emitted request once and explicitly wait for an observed retry before checking acceptance milestones. Keep transport failures enabled so the test still proves telemetry failure does not block runtime progress.

## Minimal Reproducible Example

Run the records-live-and-background-acceptance case in packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-foreground-input.test.ts after adding a wait for the trace port to receive a repeated request. The uncorrected assertion deterministically counts more attempts than logical events.

## Context

The platform coverage lane blocked an unrelated scheduled reconciliation fix. A focused local run passed until retry timing was explicitly exercised; the corrected fixture covers that timing without changing production code.
