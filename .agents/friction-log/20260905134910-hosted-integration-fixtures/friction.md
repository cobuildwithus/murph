---
title: 'Hosted integration fixtures wait for omitted writes and ignore retained warmth'
severity: 'minor'
---

## Expected Behavior

Hosted integration proof should synchronize on an actual production lock and accept the supported same-member warm-target lifecycle while enforcing exact replacement fences.

## Current Behavior

The Linq-first concurrency fixture waits indefinitely for a routing upsert when the seeded home route is unchanged and production correctly skips that write. The foreground replacement fixture assumes every new fence consumes a pristine slot, even when the same member retains a native-warm target.

The checkpoint barrier also creates its deferred promise in an idle control Durable Object. After that context hibernates, workerd cancels its continuations even though release succeeds and a separate runner is still waiting. The regular Workers test pool masks this by forcing `no_handle_cross_request_promise_resolution`.

## Minimal Reproducible Example

Run the four Telegram/Linq planner concurrency cases with PostgreSQL and the foreground-reply-priority hosted scenario after unified runner allocation.

## Context

Synchronize the Linq-first fixture after the real member-row lock and before mailbox writes. Preserve the exact new fence, canonical progress, delivery, and untouched pristine inventory assertions. Create checkpoint waits in each live waiting request, and use an ordinary local Worker to prove they resume after the control object hibernates. The signed reply requirement remains unchanged.
