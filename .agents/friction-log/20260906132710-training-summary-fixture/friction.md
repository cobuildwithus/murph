---
title: 'Training summary fixture expires against the wall clock'
severity: 'minor'
---

## Expected Behavior

The synthetic training projection test should give the same result on every date.

## Current Behavior

The test supplies a fixed replica date but omits the selector's `now` option. The selector uses the wall clock, so completed fixture sessions eventually leave the summary window. The unchanged test failed in CI and in a focused local run.

## Possible Solution

Pass the replica date and an explicit time zone to the selector. Keep the production lookback rule and all summary assertions unchanged.

## Minimal Reproducible Example

Run the first training summary test in `apps/web/test/browser-training-view.test.ts` after its fixed fixture sessions cross the summary lookback boundary. One completed session disappears from the expected aggregate. Passing the fixture date as `now` restores the intended test boundary.

## Context

This unrelated time-dependent fixture blocked focused Journal PR completion. Neither the training selector nor this test had changed in that candidate.
