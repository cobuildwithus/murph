---
title: 'Concurrent place story test releases its writer before pending reads finish'
severity: 'minor'
---

## Expected Behavior

The PostgreSQL concurrency test should prove one writer wins and other readers see the in-progress row while the writer is held.

## Current Behavior

The test releases the mock provider as soon as one writer enters it. Some readers can then see the completed row. The number of ready responses depends on database scheduling even when the provider runs exactly once.

## Minimal Reproducible Example

Run the existing first-flip test in game-progress-place-art-postgres.test.ts against an isolated loopback database under load. A reader that finishes after the writer publishes returns the ready story.

## Context

This makes verification of shared art claims intermittent. Hold the writer until the other five readers have returned.
