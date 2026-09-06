---
title: 'Training summary fixture ages out of its rolling date window'
severity: 'minor'
---

## Expected Behavior

The canonical Training view fixture should keep proving its August workout history independently of the machine date.

## Current Behavior

The summary fixture calls the selector without its existing clock option. Once the fixed completed workout falls outside the rolling 30-day window, unrelated release CI fails with one workout instead of two.

## Possible Solution

Pass the fixture date and UTC through the selector's existing options. Keep production time handling unchanged.

## Minimal Reproducible Example

Run the browser-training-view Vitest file with a September 6 clock. The canonical-session summary case fails with exercise, set, day and workout counts below its fixture expectations.

## Context

Observed in release Web shard 4 while preparing standby activation. Reproduced locally before the test-only correction.
