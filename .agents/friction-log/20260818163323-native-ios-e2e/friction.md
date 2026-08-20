---
title: 'Native iOS E2E live concurrency replaces pending runs'
severity: 'minor'
---

## Expected Behavior

Trusted native iOS E2E jobs sharing the destructive live lane should wait in arrival order so every selected pull request reaches a terminal result.

## Current Behavior

A job-level concurrency group with `cancel-in-progress: false` still permits only one pending job by default. When another selected run reaches the group, GitHub Actions cancels and replaces the existing pending job even though the running job is preserved.

## Possible Solution

Set `queue: max` on the live job concurrency group and retain `cancel-in-progress: false`.

## Minimal Reproducible Example

1. Start one synthetic job in a shared concurrency group.
2. Queue a second job with `cancel-in-progress: false`.
3. Queue a third job before the first completes.
4. Observe that the second pending job is canceled unless the group sets `queue: max`.

## Context

The live lane serializes destructive non-production E2E ownership. Replacing an already pending run discards completed prerequisite work and delays exact-head activation evidence.
