---
title: 'Action-approval database tests leak members into migration census proofs'
severity: 'minor'
---

## Expected Behavior

A database test removes the synthetic records it creates before disconnecting so later proof files can inspect their own census.

## Current Behavior

The action-approval database suite disconnects without removing its nine synthetic members. A subsequent cleanup-enrollment proof correctly includes those members and fails five expectations when both suites share the CI database.

## Possible Solution

Track the exact member IDs created by the action-approval suite and delete them in teardown before disconnecting. Keep the migration census and its expectations unchanged.

## Minimal Reproducible Example

Create an isolated loopback test database and apply migrations. Run `apps/web/test/action-approvals.db.test.ts`, then `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts` against that same database with PostgreSQL proof enabled. The second suite fails five cases before teardown is fixed.

## Context

This blocks the PostgreSQL CI shard for runtime migration cleanup despite each suite passing on a fresh database.
