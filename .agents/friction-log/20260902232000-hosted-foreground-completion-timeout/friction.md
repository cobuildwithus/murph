---
title: 'Foreground-priority E2E times out before the configured idle checkpoint'
severity: 'minor'
issue: 'cobuildwithus/murph#2760'
---

## Expected Behavior

The foreground-priority E2E should allow the background Environment item to resume after the production-like idle-checkpoint boundary when no extra wake races in first.

## Current Behavior

The scenario configures a 180-second idle-checkpoint delay but waits only 120 seconds for the deferred Environment item. It passes when an incidental wake resumes work early and fails when the runtime follows the configured idle path.

## Possible Solution

Derive the completion deadline from the scenario's production-like idle-checkpoint delay and retain a bounded margin for the resumed invocation.

## Minimal Reproducible Example

Run the hosted-local `foreground-reply-priority` scenario without an extra wake after the foreground reply. The reply succeeds, the replacement invocation completes after the configured idle checkpoint, and the shorter Environment completion poll expires first.

## Context

The mismatch makes the private release-admission workflow intermittently reject an otherwise successful foreground-preemption journey.
