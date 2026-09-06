---
title: 'Device cleanup E2E assumes atomic status samples'
severity: 'minor'
---

## Expected Behavior

The device non-starvation scenario should wait until the expected dirty-resource count and both pending flags converge under its existing observation deadline.

## Current Behavior

The status helper reads the count and pending flags independently. The final acknowledgement can commit between reads. The scenario stops polling on a zero count and immediately asserts the earlier flags are false.

## Minimal Reproducible Example

Read a pending flag before the final dirty acknowledgement commits, then read the resource count after it commits. The sampled tuple contains a true flag and zero resources even though the acknowledgement transaction is atomic.

## Context

Poll the complete expected tuple, preserving the deadline, positive-count semantics and later delivery and idle assertions.
