---
title: 'Native lint command traverses downloaded build dependencies'
severity: 'minor'
---

## Expected Behavior

The murph-ios documented `swiftformat --lint .` check should verify repository-owned source after building the prescribed local QA targets.

## Current Behavior

After build-for-testing writes DerivedData under `build/dd`, the command traverses `build/dd/SourcePackages/checkouts` and reports formatting errors in downloaded dependencies. In the synthetic game QA checkout, all reported errors came from build dependencies; repository source passed `swiftformat --lint . --exclude build`.

## Possible Solution

Exclude the generated build directory in the native formatter configuration or document an equivalent source-only invocation.

## Minimal Reproducible Example

In murph-ios, generate the project, build a scheme with `-derivedDataPath build/dd`, then run `swiftformat --lint .`. Compare with `swiftformat --lint . --exclude build`.

## Context

Encountered during cross-repository synthetic game QA. No downloaded dependency source should be reformatted to satisfy a product change's verification gate.
