---
title: 'Mailbox retention test counts unrelated database pool warnings'
severity: 'minor'
---

## Expected Behavior

The scheduled-wake retention PostgreSQL test should assert the two mailbox dedupe-conflict diagnostics produced by its synthetic replay cases.

## Current Behavior

The test counts every console warning. A database pool-pressure diagnostic can add a third warning depending on timing, failing an otherwise successful retention scenario. The focused owner-4 case reproduced locally; the same CI shard passed on retry.

## Possible Solution

Count warnings whose message is the mailbox dedupe-conflict diagnostic, while retaining the existing checkpoint and replay result assertions.

## Minimal Reproducible Example

Run apps/web/test/device-sync-scheduled-wake-retention-postgres.test.ts against an isolated local test database with one connection. The owner-4 retained-wake case may emit a pool-pressure warning in addition to its two expected conflict warnings.

## Context

Discovered while verifying a behavior-preserving device-settings refactor. This is timing-sensitive test proof; no production behavior needs changing.
