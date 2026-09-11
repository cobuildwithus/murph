---
title: 'Production canary outcome fixture expires after 24 hours'
severity: 'minor'
---

## Expected Behavior

The canonical-outcome observer tests exercise decryption, goal counting, and authority checks independently of the day they run.

## Current Behavior

The fixture has a fixed replica publication timestamp but leaves Date.now live. After the production 24-hour freshness window, the reader returns not-ready before reaching those assertions, failing ten tests in the Web shard and in a focused local run.

## Possible Solution

Pin the test clock relative to its synthetic publication timestamp, restore it after each test, and explicitly test a timestamp outside the freshness window. Preserve the production freshness policy.

## Minimal Reproducible Example

Run `pnpm --dir apps/web test:prepared test/hosted-onboarding-linq-production-canary-outcome.test.ts` more than 24 hours after the fixture timestamp.

## Context

This existing-main fixture blocks unrelated PR completion once its synthetic timestamp expires.
