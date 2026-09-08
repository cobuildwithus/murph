---
title: 'Junction legacy coverage test omits historical introspection fixture'
severity: 'minor'
---

## Expected Behavior

The legacy coverage scheduler regression should run entirely against deterministic provider responses without entering request retry delays.

## Current Behavior

The service test models provider inventory and summary responses but throws for historical-pull introspection. The client treats that throw as a retryable request failure, causing the focused test to spend time in backoff and intermittently exceed its timeout.

## Possible Solution

Return an explicit empty introspection result for the synthetic unavailable-evidence case. The task adds this response without changing the coverage assertions.

## Minimal Reproducible Example

Run pnpm --dir packages/device-syncd test test/service.test.ts on the parent of the fixture correction and select the legacy Junction coverage progress test. Its fetch stub lacks /v2/introspect/historical_pull although provider execution requests it.

## Context

This delayed verification of historical retry diagnostics. The issue is in test response coverage, not in production retry timing.
