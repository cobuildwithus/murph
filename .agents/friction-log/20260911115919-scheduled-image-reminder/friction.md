---
title: 'Scheduled image reminder proof seeds Starter access'
severity: 'minor'
---

## Expected Behavior

The scheduled image delivery proof should seed a member with the subscription entitlement required for image generation.

## Current Behavior

The scenario omits a billing plan, so the shared member seed creates Starter usage. The image-access owner correctly denies image generation, and the scenario times out waiting for an attachment-bearing reminder.

## Minimal Reproducible Example

Run the hosted-local `linq-scheduled-reminder` scenario with the current image subscription policy. Its first scenario seeds no billing plan and still expects a generated illustration.

## Context

This is an integration fixture mismatch. Preserve the shipped subscription requirement and all scheduling, delivery, and billing assertions.
