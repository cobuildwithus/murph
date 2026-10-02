---
title: 'Public Web artifact timeout discards completed builds'
severity: 'minor'
---

## Expected Behavior

The optional public Web build should have enough bounded time to finish the canonical compilation, tracing, and emitted-runtime checks before publishing its reusable artifact.

## Current Behavior

A successful hosted attempt took 6 minutes 24 seconds. Another attempt reached the final emitted-runtime check but exceeded the seven-minute build-step deadline, skipped artifact publication, and selected the paid private fallback.

## Possible Solution

Allow twelve minutes for the credential-free build and expand the job deadline by the same five minutes. Preserve the existing 58-minute post-token controller budget and two-minute cleanup reserve.

## Minimal Reproducible Example

Run the public main admission workflow from a clean hosted runner with its existing synthetic integration configuration. Inspect the build-step deadline and whether the artifact upload runs after the final runtime check.

## Context

A bounded optional build still needs realistic headroom. Rejecting otherwise healthy output near the deadline defeats public artifact reuse and repeats compilation on the private runner.
