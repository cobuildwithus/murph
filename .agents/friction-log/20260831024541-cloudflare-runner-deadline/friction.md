---
title: 'Cloudflare runner deadline test can wait forever on synthetic generation drift'
severity: 'minor'
---

## Expected Behavior

The runner-container deadline cleanup test should deterministically abort the caller deadline and finish promptly in focused and CI execution.

## Current Behavior

The test reports the current wall clock as the container state's `lastChange` on every read. A slower cleanup read can therefore make an unchanged synthetic container look like a newer generation. Production correctly refuses to destroy that apparently newer generation, while the test waits indefinitely for destroy to start because the runner Vitest project has unbounded test and hook timeouts.

## Possible Solution

Update the synthetic `lastChange` only when the mocked container actually changes state.

## Minimal Reproducible Example

Run the runner-container test filtered to the stale-rollout deadline-cleanup case with a bounded diagnostic timeout. It intermittently reaches the diagnostic timeout instead of completing.

## Context

This can stall the required application-verification job without a failing assertion, hiding the responsible test and consuming a CI runner until the workflow is cancelled.
