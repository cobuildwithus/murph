---
title: 'Native Codex source build exceeds latency-proof setup deadline'
severity: 'minor'
---

## Expected Behavior

The one-vCPU latency proof should prepare both exact runner images before comparing bounded benchmark samples.

## Current Behavior

The proof invokes runner:docker:base with a ten-minute command timeout and a fifteen-minute workflow-step timeout. A checksum-pinned native Codex source build takes about fifty-five minutes on a cold Linux runner, so setup times out before any latency sample runs.

## Possible Solution

Give native image preparation its own bounded build deadline while preserving benchmark container deadlines and regression thresholds.

## Minimal Reproducible Example

On a fresh Linux CI runner without the candidate image fingerprint, run the production runner bundle job with a changed native Codex patch. Image preparation exceeds the command deadline before benchmark execution.

## Context

The native voice integration adds a reproducible source build to the existing runner-image owner. The failure is in proof setup timing, not a measured runtime latency regression.
