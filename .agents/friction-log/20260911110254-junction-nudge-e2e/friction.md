---
title: 'Junction nudge E2E accepts rejected provider sends as delivery'
severity: 'minor'
---

## Expected Behavior

The composed activity-nudge proof should require provider acceptance before claiming one successful delivery.

## Current Behavior

The test waits for an observed Linq request and checks its text, even when the strict stub rejects that request with HTTP 400. A synthetic device-activity automation generates a 272-character key against the provider's 255-character limit. The test then fails later on extra model requests instead of identifying the failed delivery boundary.

## Possible Solution

Use the existing accepted-send wait and count helpers, preserve the exact total request count, and cover oversized keys at the real Linq serialization boundary without changing persisted authority metadata.

## Minimal Reproducible Example

Run the Junction wearable direct-resource replay scenario with a synthetic activity automation whose encoded path makes its full delivery key exceed 255 characters. The old observed-send assertion succeeds although the stub has accepted no nudge.

## Context

This mismatch delayed integration triage and hid a deterministic provider-contract defect behind later request-count failures.
