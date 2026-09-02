---
title: 'Hosted-local process integration readiness deadline flakes under coverage'
severity: 'minor'
---

## Expected Behavior

The synthetic MinIO child may take longer to start on a shared CI runner, while the process-cleanup assertion remains independently bounded after readiness.

## Current Behavior

The integration test allowed only five seconds for its synthetic child to create a readiness marker. Two exact-head package-coverage runs timed out at that precondition even though the unchanged cleanup behavior was never exercised; the focused test and full package coverage pass locally.

## Possible Solution

Keep the cleanup deadline unchanged, but give the scheduler-dependent startup precondition a separate allowance and size the outer test timeout for both phases.

## Minimal Reproducible Example

Run the hosted-local-harness coverage suite on a GitHub-hosted Ubuntu runner with half of the available Vitest workers. The process-ownership integration test can time out waiting for its synthetic readiness marker before beginning the cleanup assertion.

## Context

This blocks the required Host Support aggregator after package coverage was split into explicit exhaustive shards.
