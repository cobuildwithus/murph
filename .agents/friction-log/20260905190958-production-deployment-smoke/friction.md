---
title: 'Production deployment smoke cannot verify standby inventory readiness'
severity: 'minor'
issue: 'cobuildwithus/murph#2976'
---

## Expected Behavior

The protected deployment smoke should verify current-release ready inventory before standby activation.

## Current Behavior

The public health response reports only the configured standby mode. The only HTTP inventory inspector belongs to the hosted-local test composition, which must remain disabled in production. A successful existing smoke therefore cannot prove two spare containers are ready.

## Possible Solution

Extend the existing callback-signed deployment smoke with bounded current-release inventory counts, using the canonical coordinator and existing retry policy.

## Minimal Reproducible Example

Inspect the deployment smoke response in a synthetic shadow-mode fixture: it succeeds without calling the standby coordinator or returning inventory proof.

## Context

Blocks completion of the documented shadow-to-allocation verification sequence.
