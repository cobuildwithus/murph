---
title: 'Linq canary loses completed-turn timing after a later reply failure'
severity: 'minor'
---

## Expected Behavior

A failed synthetic production journey should identify the failed turn and retain content-free timings for earlier replies.

## Current Behavior

The runner previously returned timings only after all three turns succeeded. An unavailable reply reported no turn number, so diagnosing the first container reply required reconstructing the journey from other evidence.

## Minimal Reproducible Example

In the focused canary test, allow the welcome to succeed and end the reply stream on turn two. The original runner throws a generic reply-unavailable error and exposes no timing callback.

## Context

Corrected in the identity-canary follow-up: report each reply before budget validation and include the unavailable turn and stage. Keep message contents, account identifiers, and credentials out of telemetry.
