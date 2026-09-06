---
title: 'Unified fleet E2E still assumes one ready slot and shell prewarming'
severity: 'minor'
issue: 'cobuildwithus/murph#2956'
---

## Expected Behavior

Hosted-local integration should exercise the current multi-slot allocation contract and the normal signed-message delivery path.

## Current Behavior

Webhook scenarios wait for telemetry from removed shell-prewarm producers. Foreground-priority proof compares the claimed target with only the first ready slot. The stale-invocation fixture supplies a legacy name even when its member already retains an opaque target, so the reservation guard rejects test setup.

## Minimal Reproducible Example

Run the hosted-local linq-webhook and foreground-reply-priority scenarios with the unified fleet and its default two-slot ready target.

## Context

These stale fixtures block cross-repository integration and rollout verification after the public runtime merge. Correct the test owners while preserving delivery, background exclusion, and exact-target recovery assertions.
