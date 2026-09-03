---
title: 'Hosted member seed helpers race process-wide environment when called concurrently'
severity: 'minor'
issue: 'cobuildwithus/murph#2647'
---

## Expected Behavior

Hosted-local member seed calls either remain isolated under concurrency or enforce serialization around process-wide environment setup.

## Current Behavior

Each seed call snapshots, overwrites, and asynchronously restores `process.env`. Overlapping calls can restore missing synthetic crypto configuration while the peer seed is still writing routing data, causing a nondiagnostic failure before runtime execution.

## Possible Solution

Remove process-wide environment dependency at the test seam or serialize inside the helper. Until then, call sites must not invoke the helper concurrently.

## Minimal Reproducible Example

Run two `seedActiveHostedLinqMember` calls under `Promise.all` with the same synthetic hosted-local environment; one call can lose the generated crypto authority configuration during its routing write.

## Context

This race made the group-email newsletter integration lane fail during test seeding, before any assistant provider request or hosted runtime start.
