---
title: 'Shared PostgreSQL proof suites contend on the runtime cutover singleton'
severity: 'minor'
issue: 'cobuildwithus/murph#4442'
---

## Expected Behavior

Focused PostgreSQL suites selected together should either isolate global fixtures or clearly require serial file execution.

## Current Behavior

The runtime-owner suite updates and locks the singleton hosted_runtime_cutover row. Other suites share the same DATABASE_URL and can concurrently acquire its NOWAIT admission lock while creating synthetic game profiles. Selecting both suites with two file workers can intermittently fail an otherwise unrelated game test.

## Possible Solution

Use a separate database per suite that mutates global control fixtures, or mark the affected PostgreSQL lane as serial and document that boundary. Keep intentional within-test concurrency enabled.

## Minimal Reproducible Example

Use a migrated loopback murph_test database. Set MURPH_TEST_POSTGRES_CONCURRENCY=1 and run Vitest with apps/web/vitest.workspace.ts, selecting apps/web/test/game-service-postgres.test.ts and apps/web/test/hosted-runtime-owner-postgres.test.ts with --maxWorkers=2. Timing determines the collision. The runtime-owner fixture updates the runtime cutover row in its setup and several boundary tests; game profile setup also exercises that admission boundary. Running the files serially avoids cross-suite interference without changing either product lock.

## Context

Encountered during backend concurrent-game verification. The same composed test selection passed before the timing-dependent fixture collision. No production access or data is involved.
