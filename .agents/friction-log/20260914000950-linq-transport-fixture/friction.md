---
title: 'Linq transport fixture retains obsolete nutrition caption'
severity: 'minor'
---

## Expected Behavior

The exact one-part iMessage transport fixture should assert the current nutrition-card layout contract, consistent with the dedicated renderer tests.

## Current Behavior

The transport fixture still expects an ISO date and "logged meals" caption after the renderer moved to the short calendar date and "meals" wording. The dedicated layout tests already assert the current caption, but the stale transport expectation fails the platform package coverage shard and its required release gate.

## Possible Solution

Update the stale expected caption while retaining the complete request-body equality, capability request, image URL, app identity, and one-part assertions.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config packages/operator-config/vitest.config.ts test/http-linq-device-runtime.test.ts -t 'linq runtime checks iMessage capability and sends the exact one-part app card body'`. Compare that expectation with the existing daily-nutrition layout fixture in `packages/operator-config/test/assistant-response-cards.test.ts`.

## Context

A canary verification correction cannot reach protected main while this unrelated fixture contradicts the existing renderer contract. Production behavior does not need to change.
