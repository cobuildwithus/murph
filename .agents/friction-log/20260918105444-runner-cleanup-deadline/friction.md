---
title: 'Runner cleanup deadline test assumes a fixed microtask count'
severity: 'minor'
---

## Expected Behavior

The shared cleanup-deadline test should wait for its status-read boundary before advancing the fake clock.

## Current Behavior

The test awaits two resolved promises before asserting the second status read. A rejection-preserving catch on the startup transport adds one microtask and makes the assertion fail even though the cleanup budget and settlement behavior are unchanged.

## Minimal Reproducible Example

Add cancellation-reason preservation to the startup promise in apps/cloudflare/src/runner-container.ts, then run apps/cloudflare/test/runner-container.test.ts. The shared cleanup-deadline scenario fails its status-read call count before advancing time.

## Possible Solution

Resolve a test-owned deferred barrier when the cleanup status read begins and await that boundary instead of counting microtasks.

## Context

A readiness cancellation fix needs direct proof that slow status reads and destruction still share one cleanup deadline.
