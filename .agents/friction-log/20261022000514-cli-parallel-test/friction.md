---
title: 'CLI parallel test wrapper advertises an unusable each helper'
severity: 'minor'
---

## Expected Behavior

The exported localParallelCliTest has Vitest's test type, so parameterized tests using its each method should collect and run.

## Current Behavior

Calling localParallelCliTest.each during collection throws TypeError while reading withContext. The wrapper copies Vitest methods with Object.assign, but the copied method is invoked without the required Vitest context. Ordinary tests using the wrapper work.

## Possible Solution

Either preserve Vitest's method context in the wrapper or narrow its public type so unsupported methods fail during typecheck.

## Minimal Reproducible Example

In a CLI test file, import localParallelCliTest from ./local-parallel-test.js, then register localParallelCliTest.each(['synthetic'])('case %s', () => {}). Run that file with the CLI Vitest workspace configuration. Collection fails before the case runs. A plain for loop registering localParallelCliTest calls succeeds.

## Context

This prevented collection of newly composed CLI journey tests. The task uses plain loop registration without changing the shared helper.
