---
title: 'Document and meal command schema proof can exceed its fixed test budget'
severity: 'minor'
issue: 'cobuildwithus/murph#2930'
---

## Expected Behavior

The focused document and meal command schema regression should finish within its declared test budget on the supported shared verification lane.

## Current Behavior

The existing aggregate schema test timed out at its fixed 45-second limit on two focused invocations. No schema assertion failed before the timeout. A separate focused in-process meal totals invocation and the CLI typecheck completed successfully.

## Possible Solution

Inspect repeated command-schema materialization within the aggregate case. Reuse the existing manifest or separate independent schema assertions when that preserves the production boundary, rather than masking slow preparation with a blanket timeout increase.

## Minimal Reproducible Example

From an installed task checkout, run `pnpm --dir packages/cli exec vitest run --config vitest.config.ts --no-coverage test/cli-expansion-document-meal.test.ts -t 'document and meal command schemas expose'`.

## Context

This slows focused validation of a new read-only meal totals option. The feature's direct CLI behavior has independent passing proof; broad exact-head CI remains required.
