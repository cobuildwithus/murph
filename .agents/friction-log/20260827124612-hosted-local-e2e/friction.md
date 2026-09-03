---
title: 'Hosted-local E2E cannot start when the runner total-byte baseline lags current main'
severity: 'minor'
issue: 'cobuildwithus/murph#2513'
---

## Expected Behavior

A named hosted-local E2E scenario should assemble the exact current runner and reach the scenario when its patch does not introduce disallowed boot inputs or excessive candidate-relative growth.

## Current Behavior

The production bundle's fixed total-byte ceiling can lag cumulative changes already present on the task branch base. The hosted-local launcher then stops during runner assembly before any scenario code runs, even though the authoritative Linux gate is designed to compare the exact base and candidate and the patch may reduce source size.

## Possible Solution

Keep the entry-chunk and static-closure guards fail-closed, while either ratcheting the local total baseline whenever the integrated main graph changes or giving hosted-local the same exact-base relative total-growth check owned by CI.

## Minimal Reproducible Example

1. Check out a current main revision whose integrated runner graph is newer than the last total-byte baseline.
2. Run `pnpm hosted-local e2e foreground-reply-priority`.
3. Observe runner assembly reject the fixed total ceiling before the Vitest scenario starts.

## Context

This blocked production-shaped verification for a mailbox scheduling simplification. Focused unit and integration tests could run, but the composed journey never reached Web, Cloudflare, Temporal, or the runner.
