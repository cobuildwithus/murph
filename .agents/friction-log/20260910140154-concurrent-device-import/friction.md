---
title: 'Concurrent device-import proof times out before its foreground assertion'
severity: 'minor'
issue: 'cobuildwithus/murph#3212'
---

## Expected Behavior

The concurrent device-import integration proof should allow its two-reply setup to finish on the shared-host verification profile, then enforce its separate model-to-delivery latency and checkpoint ordering assertions.

## Current Behavior

The five-second outer wait expires during canonical import or before the second reply under local contention. Two isolated repetitions failed before entering the projection code under test. Source transformation also took over two minutes, although the test scenario itself remains bounded.

## Possible Solution

Use the existing twenty-second runtime completion allowance for the two-reply orchestration gate. Preserve the independent two-second model-to-delivery assertion and all event-order checks.

## Minimal Reproducible Example

Run the assistant-runtime concurrent-device-import integration test with the acknowledgment and empty-wake scenarios on a busy shared development host. The outer wait can reject while device import and the first foreground pass are still progressing.

## Context

This obscured the result of a deterministic checkpoint-starvation regression. The production failure reproduces through a bounded checkpoint-count assertion separately from this test-harness deadline.
