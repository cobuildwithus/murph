---
title: 'Latency PostgreSQL overlap proof ignores reported lock contention'
severity: 'minor'
---

## Expected Behavior

Concurrent latency milestone proof should honor the store's explicit contention receipts and verify complete JSON merge after retrying skipped work.

## Current Behavior

The overlap case launches two assistant milestone writes on the same traces but discards both receipts. Production uses SKIP LOCKED, so one call can legitimately report contention and omit its milestone. The final assertion incorrectly requires both milestones before any replay. This causes intermittent required PostgreSQL shard failures.

## Possible Solution

Keep concurrent writes, assert that unmatched rows are explicitly accounted for as contention, and replay only a contended milestone through the existing store after both writers complete. Preserve all final authority, sanitization, UTC, and atomic merge assertions.

## Minimal Reproducible Example

Run the atomic merge overlap case in `apps/web/test/hosted-runtime-latency-postgres-concurrency.test.ts` against an isolated migrated local database. A test-only row-update delay during initial typing milestone writes forces overlap and reproduces the missing accepted milestone before the correction; the same schedule passes after receipt-aware replay.

## Context

The production nonblocking lock policy is intentional and already covered by the same suite. This correction affects test orchestration only.
