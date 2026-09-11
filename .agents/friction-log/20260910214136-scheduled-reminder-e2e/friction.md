---
title: 'Scheduled reminder E2E serializes independent real-time journeys'
severity: 'minor'
---

## Expected Behavior

Independent scheduled-delivery journeys can run in separate CI jobs while every scheduler and delivery assertion remains required.

## Current Behavior

The scheduled reminder scenario runs image/checkpoint recovery, foreground overlap, and native nutrition-card delivery sequentially in one test. Each phase creates a separate minute-aligned reminder with a ninety-second minimum lead, accumulating several minutes of real-time waiting in one gate.

## Minimal Reproducible Example

Run `pnpm hosted-local e2e linq-scheduled-reminder` with the synthetic hosted-local prerequisites. Observe that all three independently scheduled phases execute within one test.

## Possible Solution

Expose the three journeys through the harness's existing declared process inventory and run all process shards in the private predeploy matrix.

## Context

Predeploy latency optimization; preserve real scheduler timing and every success assertion.
