---
title: 'Junction admission test rejects unrelated digits inside an opaque source hash'
severity: 'minor'
---

## Expected Behavior

The disconnected-source admission test should reject the disconnected provider and its exact clinical values while accepting an unrelated opaque source identity.

## Current Behavior

The test in `packages/device-syncd/test/service.test.ts` applies `/fitbit|provider-fitbit-1|1234|"value":91/u` to the entire serialized importer input. A generated source hash containing `1234` fails the test even when the admitted payload contains only the connected provider and the expected values. This makes otherwise unchanged coverage runs intermittently fail.

## Possible Solution

Assert provider identity and measurement values through their typed fields, or narrow the value matcher to the exact numeric JSON field instead of arbitrary substrings.

## Minimal Reproducible Example

The existing regular expression matches the synthetic JSON `{"sourceInstanceId":"source-ab1234cd","steps":4321,"value":97,"sourceProviderSlug":"garmin"}` even though it contains neither the disconnected provider nor either rejected clinical value.

## Context

An unrelated CLI change encountered this false positive in the platform-b coverage job. A rerun is a temporary workaround; the matcher remains overly broad.
