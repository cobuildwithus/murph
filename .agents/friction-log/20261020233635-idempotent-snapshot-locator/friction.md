---
title: 'Idempotent snapshot locator setup fails on a local worker restart'
severity: 'minor'
issue: 'cobuildwithus/murph#4268'
---

## Expected Behavior

Hosted-local release scenarios should finish idempotent snapshot fixture setup when Wrangler explicitly reports a mid-request worker restart, using bounded recovery that preserves all scenario assertions.

## Current Behavior

The marker POST fails immediately on Wrangler's restart-specific 503. The failure happens before the foreground scenario starts. The existing wake helper recognizes this condition, but snapshot marker setup does not.

## Minimal Reproducible Example

Use a synthetic snapshot marker request and a fetch stub returning the exact Wrangler restart response once, followed by success. The current harness throws after the first response. Also exercise repeated restart responses and unrelated failures to prove a finite recovery boundary.

## Context

This is test-harness reliability at a local R2 marker boundary. Repeating the same validated zero-byte marker write is idempotent. No production retry or timeout change is needed.
