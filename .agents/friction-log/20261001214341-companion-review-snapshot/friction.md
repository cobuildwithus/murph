---
title: 'Companion review snapshot rejects the private packager metadata layout'
severity: 'minor'
issue: 'cobuildwithus/murph#3972'
---

## Expected Behavior

A guarded companion snapshot from the private consumer repository can be included in a public producer review, or the integration declares its incompatible metadata format before packaging.

## Current Behavior

The public review launcher packages both repositories, then rejects the companion ZIP because it does not retain unique guarded review-round metadata. No review request is sent.

## Minimal Reproducible Example

Run the public final-review launcher with an exact-head companion descriptor for a clean private consumer PR using its committed guarded packager. The companion validation rejects the generated archive before browser staging.

## Context

Cross-repository canary receipt review. Independent exact-head producer and consumer reviews remain available, so the task does not need a packaging bypass.
