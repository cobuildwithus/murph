---
title: 'Hosted MinIO cleanup test reuses a pre-loader readiness timeout'
severity: 'major'
issue: 'cobuildwithus/murph#2792'
---

## Expected Behavior

The hosted-local cleanup ownership test should allow its TypeScript child wrapper to finish loading before measuring bounded cleanup behavior.

## Current Behavior

The test loads the child through `tsx` but allows only five seconds for a mocked MinIO ready file. Under concurrent acceptance coverage, startup can exceed that budget even though the cleanup behavior is correct.

## Possible Solution

Give child startup its own larger bounded readiness window while keeping the post-signal cleanup assertion unchanged.

## Minimal Reproducible Example

1. Run package coverage with multiple package processes.
2. Start the hosted-local cleanup ownership test while other coverage suites are loading modules.
3. Observe the test time out waiting for `minio-ready` at five seconds.
4. Run the same test alone and observe it pass.

## Context

This makes the required acceptance gate fail nondeterministically on unrelated changes.
