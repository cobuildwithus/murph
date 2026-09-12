---
title: 'Wearable browser progress is buffered until subprocess exit'
severity: 'minor'
---

## Expected Behavior

A stalled live wearable browser should expose its current fixed execution stage while preserving all private browser and provider data.

## Current Behavior

The parent listens only for the canonical-data control marker. Navigation and cleanup can remain pending without any intermediate stage reaching the suite output.

## Minimal Reproducible Example

Run the browser with a synthetic authorization failure and a cleanup promise that remains pending. Before cleanup resolves, inspect parent-visible output: the failure stage is unavailable even though the browser already knows it.

## Context

This prevents distinguishing browser work from cleanup and host resource pressure in bounded canary runs. Forward only an exact closed stage vocabulary and numeric machine resource measurements.
