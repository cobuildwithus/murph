---
title: 'Vault-share source-recorded sleep fixture expires against the real clock'
severity: 'minor'
---

## Expected Behavior

The source-recorded sleep delivery test should verify timestamp preservation independently of the current calendar date.

## Current Behavior

The test sends fixed July records through the real delivery route while using the real clock. Once those records are older than the route's 60-day legacy history window, the route correctly filters them out and the unrelated timestamp assertion fails.

## Possible Solution

Pin Date.now within this test to the day after its synthetic fixture and restore it when the test finishes. Preserve the production history filter and the existing timestamp assertions.

## Minimal Reproducible Example

Run `pnpm --dir apps/web test vault-share-deliver-route.test.ts` with the clock more than 60 days after its fixed fixture date. The source-recorded sleep case fails while the other cases pass.

## Context

This expired fixture blocks the required Web CI shard for otherwise unrelated changes. The scoped test-clock correction is included with this report.
