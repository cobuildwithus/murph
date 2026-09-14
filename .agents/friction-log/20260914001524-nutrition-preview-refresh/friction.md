---
title: 'Nutrition preview refresh left Linq request-body fixture stale'
severity: 'minor'
---

## Expected Behavior

Changing a nutrition card caption should update both the layout tests and the composed Linq request-body expectation in the same change.

## Current Behavior

The caption formatter was simplified in PR #3416, but the exact request-body assertion in packages/operator-config/test/http-linq-device-runtime.test.ts retained the previous caption. This deterministic inherited failure blocked the platform-a coverage shard for PR #3422 after the other package checks completed. Neither the formatter nor its request-body test was changed by the typing repair.

## Possible Solution

Update the one stale request-body expectation to the shipped caption and include the composed Linq HTTP test when changing response-card layout contracts.

## Minimal Reproducible Example

At commit b7b467b9a2a42068bc45c6d0e4e6e25cc4a09809, run:

`pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts --no-coverage test/http-linq-device-runtime.test.ts`

The one-part app-card request assertion expects the older date and meal-label formatting. Aligning that single assertion with the current formatter makes all 83 tests in the file pass.

## Context

Discovered during final CI for the attachment typing and warm transport diagnostics repair. The correction changes test data only and preserves the shipped card layout.
