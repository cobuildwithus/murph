---
title: 'Provider timeout and durable retry fixtures wait on real clocks'
severity: 'minor'
issue: 'cobuildwithus/murph#4271'
---

## Expected Behavior

Controlled-time fixtures exercise configured deadline and retry boundaries
without waiting tens of real seconds, while preserving native cancellation and
cold-restore coverage.

## Current Behavior

The Junction refresh fixture advances fake timers but its native AbortSignal
timeout still waits 35 real seconds. The interrupted-recording projection-error
fixture controls Date for a pre-due cold restore but sleeps until the real
60-second retry deadline for the due restore.

## Minimal Reproducible Example

Run the Junction provider-client test file and the interrupted-system-recording
integration file through their package Vitest configurations. Inspect the
refresh timeout and projection-error case durations.

## Context

This is test execution overhead. Production deadlines, retry policies, no-replay
assertions, cancellation, and cold-restore proof must remain intact.
