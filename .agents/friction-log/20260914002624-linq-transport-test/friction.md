---
title: 'Linq transport test retains retired nutrition-card caption'
severity: 'minor'
---

## Expected Behavior

The Linq app-card transport assertion should match the compact nutrition caption owned by the current response-card formatter and its focused tests.

## Current Behavior

The response-card formatter and its layout tests use the compact month/day caption and meal count, but the transport test still expects the former numeric-date caption and longer meal label. This mismatch exists in the base branch and fails required platform package coverage for unrelated changes.

## Possible Solution

Update the stale transport expectation while preserving the exact request-body and two-request assertions. Keep caption behavior owned by the response-card formatter.

## Minimal Reproducible Example

Run `pnpm --filter @murphai/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts -t "checks iMessage capability and sends the exact one-part app card body"` against the base version before the expectation correction.

## Context

The mismatch blocked the platform-a package shard and required release check while validating an independent filesystem-pruning simplification. No production transport or caption behavior needs to change.
