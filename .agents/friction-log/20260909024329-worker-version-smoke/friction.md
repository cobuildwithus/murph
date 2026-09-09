---
title: 'Worker version smoke expires before edge propagation converges'
severity: 'minor'
---

## Expected Behavior

A bounded public smoke check should allow ordinary Worker version propagation before rejecting a staged release.

## Current Behavior

The check allows five attempts separated by two seconds. A staged activation can therefore fail after eight seconds even though a later public read serves the expected version. The failed deployment leaves a pending candidate, and a rebuilt bundle with different bytes correctly cannot silently replace it.

## Possible Solution

Extend the existing version-mismatch retry bound while retaining immediate failure for HTTP errors or malformed responses and a finite mismatch exhaustion limit.

## Minimal Reproducible Example

Run the real smoke helper with synthetic banner responses that return a different version for five requests, then the expected version. The original helper rejects before the sixth request. Fake-timer regression coverage also tests success on the final allowed attempt and failure when the mismatch persists.

## Context

This blocks the protected runtime recovery rollout. The existing Worker-only deployment mode can retire interrupted candidate state; a full release is still required to deliver runtime changes.
