---
title: 'Canary outcome fixtures expire against the real clock'
severity: 'minor'
---

## Expected Behavior

The canonical canary outcome tests should exercise fresh replica decryption independently of the calendar date while retaining explicit expired-replica coverage.

## Current Behavior

The suite fixes replica generation at a historical timestamp but leaves the clock live. Once the timestamp is older than the production 24-hour freshness window, ten success and error-path cases return not-ready before reaching their intended boundary. This blocks the required Web release shard for documentation-only changes.

## Possible Solution

Freeze Date at the fixture timestamp within each test, restore the real clock afterward, and advance the controlled clock explicitly when checking expiry. Keep production freshness enforcement unchanged.

## Minimal Reproducible Example

Run apps/web/test/hosted-onboarding-linq-production-canary-outcome.test.ts more than 24 hours after its generatedAt fixture timestamp. Fresh-replica cases fail with ready false. Running at the fixture time reaches the intended decryption and authorization assertions.

## Context

Discovered while completing an authorized merge after a mechanical documentation base reconciliation. The correction is confined to test clock ownership.
