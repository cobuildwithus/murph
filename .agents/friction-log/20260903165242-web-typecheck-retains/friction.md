---
title: 'Web typecheck retains stale generated route types'
severity: 'minor'
---

## Expected Behavior

The hosted Web typecheck should regenerate route types from the current route tree and ignore or remove generated entries for deleted routes.

## Current Behavior

A normal hosted Web typecheck can fail on an ignored `.next/types` entry for a route that no longer exists in source.

## Possible Solution

Clean stale generated route entries before the TypeScript checker runs, or make route type generation replace the generated tree atomically.

## Minimal Reproducible Example

1. Have a generated route type for an API route.
2. Remove the source route while leaving the ignored generated output.
3. Run the hosted Web typecheck.
4. Observe a missing-module error from the stale generated route type.

## Context

This blocks focused verification of unrelated hosted Web changes until the generated route type tree is refreshed.
