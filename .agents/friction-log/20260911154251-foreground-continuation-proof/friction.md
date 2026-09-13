---
title: 'Foreground continuation proof rejects advanced mailbox frontiers'
severity: 'minor'
---

## Expected Behavior

After seeded system wakes are imported, the continuation proof accepts frontiers at or beyond the seeded sequence while still requiring zero lag, no retryable import errors, and successful same-user processing evidence.

## Current Behavior

The observer requires exact equality with the seeded sequence before it reads processing logs. A later valid mailbox append advances both import frontiers and prevents the observer from inspecting successful continuation evidence.

## Minimal Reproducible Example

Seed through sequence 8, then let an ordinary subsequent wake advance the lane and workspace frontiers to 9 with zero lag. The equality gate rejects this completed import state without reading continuation logs. Normal completion may also release the foreground owner before later durable background work runs under a successor.

## Context

This is a synthetic verification-boundary defect, not a change to runtime ownership or mailbox processing.
