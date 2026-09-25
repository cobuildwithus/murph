---
title: 'Experiment outcome mocks split canonical lock ownership after module reset'
severity: 'minor'
issue: 'cobuildwithus/murph#3135'
---

## Expected Behavior

Experiment outcome concurrency tests should exercise one canonical lock owner
across core writes and query reads.

## Current Behavior

The test retained a static core import while resetting modules and importing
query again through a runtime mock. Nested query rebuilds then used a separate
lock context and timed out. Five assertions failed in package coverage.

## Minimal Reproducible Example

Run the experiment-outcome-concurrency test against PR #3090 before its test
setup correction. A static core lock wraps a query loaded after resetModules.
The next-day retry also freezes timers, preventing lock timeout progress.

## Possible Solution

The PR removes the runtime module resets and uses direct spies on the existing
core and query exports. All six existing tests pass without changing assertions.

## Context

Found while validating concurrent imports. This is test setup friction; a
separate production query coordination cycle has its own focused regression.
