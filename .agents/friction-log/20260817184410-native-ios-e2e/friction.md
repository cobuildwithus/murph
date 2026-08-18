---
title: 'Native iOS E2E lifecycle discards both cleanup failure causes'
severity: 'minor'
---

## Expected Behavior

When both the primary lifecycle and fail-closed finalization fail, the controller should retain secret-safe phase or error-code evidence for each failure.

## Current Behavior

The lifecycle replaces both causes with one generic message. A live failure therefore exposes only the last successful stage markers, forcing repeated full reruns and external resource inspection to distinguish command failure from postcondition failure.

## Possible Solution

Surface allowlisted internal failure messages or structured phase codes while continuing to discard provider payloads, command output, and credentials.

## Minimal Reproducible Example

Call runPrLifecycle with a cleanup callback that throws during the primary attempt and again during finalization. The rejected error says only that final cleanup did not complete and omits both controlled callback errors.

## Context

This blocks focused diagnosis of the protected hosted Web plus native iOS acceptance lane and lengthens recovery while its required status remains red.
