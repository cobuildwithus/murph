---
title: 'Web build ownership change left the WAF assertion stale'
severity: 'minor'
---

## Expected Behavior

A required build-order test should continue to assert the intended first preflight after the production build command changes ownership shape.

## Current Behavior

The Web build command starts directly with the WAF preflight, but its required test still expects the removed outer host-slot wrapper and fails the full app verification lane.

## Possible Solution

Assert that the current build command begins with the WAF preflight instead of matching the retired wrapper syntax.

## Minimal Reproducible Example

1. Remove the outer build wrapper while preserving the same first preflight.
2. Run the focused public-routes WAF test.
3. Observe that the wrapper-shaped regular expression fails even though the ordering invariant still holds.

## Context

The stale assertion blocks required pull-request verification for changes unrelated to the Web build command.
