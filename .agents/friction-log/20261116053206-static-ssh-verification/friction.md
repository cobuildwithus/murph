---
title: 'Static SSH verification waits twenty minutes for an unreachable worker'
severity: 'minor'
---

## Expected Behavior

The static-worker verification entrypoint should fail promptly when the worker's SSH port cannot be reached, allowing an operator to choose local verification.

## Current Behavior

The dispatcher waits through a twenty-minute bootstrap deadline even though the dedicated static target is already provisioned and its SSH port remains closed. No tests start during this wait. The task must explicitly stop its owned bootstrap process before selecting the documented local executor.

## Minimal Reproducible Example

Run the documented SSH form of pnpm test:diff while the configured static worker is unreachable. Observe repeated closed-port bootstrap messages with a twenty-minute remaining budget.

## Context

This delayed the Progress backend fix verification. The local executor provides the required proof; the report contains no machine address or account details.
