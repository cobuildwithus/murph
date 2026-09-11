---
title: 'Assistant Engine coverage omits built CLI fixture prerequisites'
severity: 'minor'
---

## Expected Behavior

A coverage shard that executes the shipped CLI should prepare its runtime artifacts before invoking package tests, including on a fresh checkout.

## Current Behavior

The canonical Assistant Engine fixture invokes the built CLI, but Host Support prepares those artifacts only for its CLI shard. The new deterministic fixture therefore fails before canonical readback on a clean Assistant Engine runner, while it passes in a checkout that already built the runtime.

## Possible Solution

Use the existing prepared-runtime step for both CLI and Assistant Engine coverage shards. Keep the shipped CLI invocation and effect assertions intact. The tag release root coverage entrypoint already prepares the artifacts unconditionally.

## Minimal Reproducible Example

1. Use a fresh checkout with the canonical live journey fixture and install frozen dependencies.
2. Generate the Health Commons catalog and run Assistant Engine package coverage without preparing runtime artifacts.
3. Observe the deterministic canonical fixture fail because the built CLI entrypoint does not exist.

## Context

An undeclared fixture prerequisite delayed exact-head CI after focused checks passed in a previously built checkout.
