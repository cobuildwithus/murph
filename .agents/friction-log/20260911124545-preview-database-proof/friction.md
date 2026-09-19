---
title: 'Preview database proof reference expires while waiting for a Vercel build slot'
severity: 'minor'
---

## Expected Behavior

The temporary Preview database proof should collect its short-lived reference only when hosted build capacity is available, while retaining its existing expiry and read-only boundaries.

## Current Behavior

The operator guide collects a 15-minute reference before submitting the build without first checking the deployment queue. A busy build slot can consume the entire reference window before the diagnostic executes, leaving database isolation unverified and requiring cleanup plus a fresh attempt.

## Possible Solution

Check build and queue metadata before collecting the reference. Wait for available capacity and an empty queue, then submit the existing reviewed carrier with a fresh reference. This preflight cannot reserve capacity; retain the existing expiry and closed result if another build wins the slot.

## Minimal Reproducible Example

1. Occupy the available hosted build capacity with an existing authorized build for longer than 15 minutes.
2. Collect a fresh reference and submit the standalone Preview proof behind it.
3. Observe that the reference expires before a database comparison can run.

## Context

The affected owner is `agent-docs/operations/preview-database-proof.md`. The correction is operational sequencing only: no longer-lived reference, credential download, production promotion, or cancellation of another task's build is needed.
