---
title: 'Static page registration can omit the telemetry pathname owner'
severity: 'minor'
---

## Expected Behavior

Adding a static App Router page should update the fail-closed Vercel telemetry pathname owner or fail in focused verification before unrelated pull requests inherit the mismatch.

## Current Behavior

The new screenshot catalog route was added without its canonical telemetry pathname. The mismatch surfaced only in the long required app-verification shard of an unrelated production fix.

## Possible Solution

Keep the static-route inventory assertion, document the coupled telemetry registration, and include its focused test in the page-addition verification path.

## Minimal Reproducible Example

Add a static page under the web app without adding its root path to the telemetry pathname owner, then run the Vercel telemetry test.

## Context

The required app-verification shard completed more than ten thousand tests before reporting the deterministic missing-path assertion.
