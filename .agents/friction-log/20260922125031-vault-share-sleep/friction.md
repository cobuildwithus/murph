---
title: 'Vault-share sleep delivery fixture expires against the wall clock'
severity: 'minor'
---

## Expected Behavior

The source-recorded sleep timestamp regression should remain deterministic as calendar time advances.

## Current Behavior

The delivery test uses fixed historical source rows with the real current clock. Once those rows leave the production retention window, delivery correctly filters them and the test expects records that are no longer eligible. This fails the broader Web test shard during unrelated work.

## Possible Solution

Pin only the Date clock inside the source-timestamp scenario and restore it in a finally block. Keep real timers and the production retention rule. This task applies that bounded fixture correction.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/vault-share-deliver-route.test.ts` after the static fixture dates have aged beyond retention. The source-recorded sleep timestamp case fails on an empty records result before the test-clock correction.

## Context

Found during reply-tool efficiency verification. All 36 delivery-route tests pass with the isolated Date clock pinned; no production delivery behavior changes.
