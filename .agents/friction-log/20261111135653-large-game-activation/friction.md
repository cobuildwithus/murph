---
title: 'Large game activation fixture can exceed its transaction budget in CI'
severity: 'minor'
issue: 'cobuildwithus/murph#4842'
---

## Expected Behavior

The PostgreSQL cardinality proof for 1,000 live games should finish its synthetic fixture setup within the transaction budget and reach its bounded-query assertions.

## Current Behavior

The existing game-private-activation-postgres test case for at most two facts per seat failed in a documentation-only candidate. Prisma reported that its 15-second interactive transaction had already been open for about 31 seconds when a gamePlayer query ran. The shard's other 486 tests passed. No game or database implementation changed in the candidate. This is one observed failure; shared-runner resource pressure is an unproven hypothesis.

## Minimal Reproducible Example

Run the Release Web PostgreSQL third shard, including apps/web/test/game-private-activation-postgres.test.ts and its synthetic 1,000-game cardinality scenario. Inspect whether fixture creation finishes before the interactive transaction expires. The failure has not yet been reproduced in isolation.

## Context

This unrelated fixture timeout blocks documentation completion. Preserve the query-count assertions and diagnose fixture setup separately before changing production transaction limits. Retry evidence belongs with the candidate; one successful retry would not establish the root cause.
