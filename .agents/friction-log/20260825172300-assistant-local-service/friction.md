---
title: 'Assistant local-service coverage repeatedly exhausts expanded heap'
severity: 'minor'
issue: 'cobuildwithus/murph#2305'
---

## Expected Behavior

The Assistant Engine coverage suite should run deterministically within the ordinary package-test memory budget, and test organization should release isolated module state at stable behavior boundaries.

## Current Behavior

One local-service runtime test module contains more than one hundred tests and reloads a heavily mocked production module for every test. V8 coverage retains enough instrumented module state that the worker now exceeds the repository-specific 6 GiB heap exception. Earlier changes raised the heap rather than removing the accumulating test-harness structure.

## Possible Solution

Split the monolithic test module into behavior-owned files with one shared test-only harness, then remove the package-specific heap exception after full coverage passes at the default limit.

## Minimal Reproducible Example

Run Assistant Engine package coverage with the default Node heap. The local-service runtime worker grows until V8 reports an out-of-memory failure even though completed assertions pass.

## Context

This blocks required pull-request and main-branch coverage while adding CI-specific configuration that masks the underlying test-maintenance problem.
