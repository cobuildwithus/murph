---
title: 'Hosted integration fixtures wait for omitted writes and ignore retained warmth'
severity: 'minor'
---

## Expected Behavior

Hosted integration proof should synchronize on an actual production lock and accept the supported same-member warm-target lifecycle while enforcing exact replacement fences.

## Current Behavior

The Linq-first concurrency fixture waits indefinitely for a routing upsert when the seeded home route is unchanged and production correctly skips that write. The foreground replacement fixture assumes every new fence consumes a pristine slot, even when the same member retains a native-warm target.

## Minimal Reproducible Example

Run the four Telegram/Linq planner concurrency cases with PostgreSQL and the foreground-reply-priority hosted scenario after unified runner allocation.

## Context

Synchronize the Linq-first fixture after the real member-row lock and before mailbox writes. Preserve the exact new fence, canonical progress, delivery, and untouched pristine inventory assertions. Add test-only checkpoint release/resume metadata for the separate Environment handoff timeout; its reply requirement remains unchanged.
