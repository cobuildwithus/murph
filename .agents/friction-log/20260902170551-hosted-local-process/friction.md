---
title: 'Hosted-local process integration masks fresh-checkout child import failure'
severity: 'minor'
---

## Expected Behavior

The process integration test should execute source imports with the repository's workspace-source resolver and surface a child exit before reporting a readiness timeout.

## Current Behavior

The integration test spawned raw Node to import the hosted-local E2E source. Vitest resolved workspace dependencies from source locally, but the raw child followed package exports to build output that is absent in a fresh CI checkout. Because the test ignored child stderr and exit before readiness, the module-resolution failure appeared as a MinIO readiness timeout.

## Possible Solution

Run the child through the existing workspace-source resolver and TypeScript loader, preserve the cleanup deadline, and race readiness against child exit with redacted diagnostics.

## Minimal Reproducible Example

Run the hosted-local-harness coverage suite from a fresh checkout without prebuilt workspace package output. The process-ownership integration test reports a MinIO readiness timeout instead of the child process's module-resolution failure.

## Context

This blocks the required Host Support aggregator after package coverage was split into explicit exhaustive shards.
