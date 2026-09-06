---
title: 'Hosted Web release CI can retain stale OpenAPI parsed-default assertions'
severity: 'minor'
issue: 'cobuildwithus/murph#2788'
---

## Expected Behavior

When a public request schema gains defaults, its OpenAPI boundary test should assert the complete parsed result so the release test remains green.

## Current Behavior

The request schema added three defaults, but the OpenAPI test still expected the previous three-field object. The same deterministic assertion failure appeared on the default branch and unrelated pull requests.

## Possible Solution

Keep the exact-object boundary assertion aligned with the schema defaults in the same change that adds or changes those defaults.

## Minimal Reproducible Example

Run the focused public-products OpenAPI test after adding a defaulted request field. The parsed example contains the default, while a stale exact-object expectation omits it.

## Context

This blocked an unrelated assistant-context pull request during required release CI and required an isolated test-only correction.
