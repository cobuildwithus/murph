---
title: 'Expired native Telegram proof leaks into global auth cleanup test'
severity: 'minor'
issue: 'cobuildwithus/murph#4703'
---

## Expected Behavior

The native Telegram proof and auth-retention PostgreSQL tests should pass in either serial order on a fresh isolated database.

## Current Behavior

The native Telegram expired-pending-start test leaves an expired pre-auth verification row after member cleanup. The adapter retention test later deletes expired records globally but asserts exactly two deletions. Running these tests in that order on a clean origin/main checkout produces three deletions and fails the assertion. The task's full serial Web run exposed the same failure; no concurrent database tests are necessary.

## Possible Solution

Clean up each fixture's pre-auth records explicitly, including rejected or expired pending starts. Preserve the production cleanup's global behavior and the live-authority assertions.

## Minimal Reproducible Example

Migrate a fresh isolated local test database and enable MURPH_TEST_POSTGRES_CONCURRENCY=1. Run better-auth-member-postgres-concurrency.test.ts filtered to "native Telegram rejects expired pending start"; it passes. Then run better-auth-adapter-postgres-concurrency.test.ts filtered to "reclaims expired sessions and pre-auth state" against the same database. The second test expects two deletions but observes three.

## Context

Reproduced in a clean detached origin/main checkout during full Web verification. This is a sequential fixture-isolation issue, separate from the runtime-cutover singleton contention recorded elsewhere.
