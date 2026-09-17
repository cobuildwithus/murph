---
title: 'Hosted-local E2E MinIO cleanup can remove another suite''s containers'
severity: 'minor'
---

## Expected Behavior

A hosted-local E2E run should clean only containers created by that run or its exact build identity.

## Current Behavior

The E2E command's final cleanup calls cleanupHostedLocalMinioE2eContainersBestEffort. That helper lists every container with the shared MinIO role and E2E labels, then forcibly removes all returned IDs without checking the current build or process owner. Running a focused scenario can therefore stop a concurrently running suite's storage service.

## Possible Solution

Restrict MinIO cleanup to the existing exact build identity, as the adjacent runner and MinIO build cleanup already do.

## Minimal Reproducible Example

Inspect packages/hosted-local-harness/src/e2e.ts::cleanupHostedLocalE2eRunnerArtifacts and packages/hosted-local-harness/src/dev-hosted-local/minio.ts::cleanupHostedLocalMinioE2eContainersBestEffort. Start two independent synthetic E2E builds; the label-only query from either build includes both containers. No destructive reproduction is needed.

## Context

Runtime cleanup verification used the focused Vitest E2E entrypoint with a unique build identity instead of the umbrella command, preserving ownership of unrelated running processes.
