---
title: 'Vault-share timestamp fixture expires against the real clock'
severity: 'minor'
---

## Expected Behavior

The vault-share delivery timestamp-preservation test should pass independently of the calendar date while retaining its exact source-recorded timestamp assertions.

## Current Behavior

The test uses literal July 2026 records with the real clock. The production route correctly removes records older than its legacy 60-day window, so the test starts receiving an empty snapshot once those fixtures expire. This blocks unrelated release CI.

## Possible Solution

Pin the clock only for the timestamp-preservation case and restore it afterward. Keep the separate stale-record and history-window tests unchanged.

## Minimal Reproducible Example

With the real clock after 2026-09-22 UTC, run `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/vault-share-deliver-route.test.ts -t 'preserves source-recorded sleep times through the deliver route'` before the correction. The fixed historical records are discarded by the real production route.

## Context

Discovered while completing native poll CI. The poll code does not touch this route. The correction belongs only to its test clock; production retention remains unchanged.
