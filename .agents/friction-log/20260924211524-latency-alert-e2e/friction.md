---
title: 'Latency alert E2E samples fall below the shipped threshold'
severity: 'minor'
---

## Expected Behavior

The hosted alert E2E seeds a reply above the shipped latency threshold so it exercises failed-send recovery, idempotency, and recurrence.

## Current Behavior

The monitor threshold is 60 seconds, but two E2E samples are 31 seconds. The real cron returns healthy and the first expected failed-send assertion receives 200 instead of 502, blocking Web admission.

## Possible Solution

Raise both synthetic slow-reply samples to 61 seconds. Preserve the shipped alert threshold and the separate production conversation canary limit.

## Minimal Reproducible Example

Run the foreground-reply-priority hosted-local journey after the 60-second alert threshold change. The operator-incident test fails at its first cron response assertion.

## Context

Found during deployment verification. This is test fixture drift, not evidence of failed production alert delivery.
