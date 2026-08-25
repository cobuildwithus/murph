---
title: 'ReviewGPT wait misses a completed marked response'
severity: 'minor'
issue: 'cobuildwithus/murph#2191'
---

## Expected Behavior

A waited ReviewGPT run should capture and persist the exact assistant response
once the managed conversation is idle and contains the requested completion
marker.

## Current Behavior

The managed conversation finished with its requested marker and an idle page,
but the wrapper continued emitting wait heartbeats. The exact response remained
readable through the thread exporter, so the review was complete while the
owning command could not recognize it.

## Possible Solution

When the primary response selector has no result, reconcile against the exact
captured conversation after the page becomes idle and accept only the assistant
turn containing the invocation nonce and requested marker.

## Minimal Reproducible Example

1. Start a waited ReviewGPT pass with a response marker and response file.
2. Let the managed conversation finish with that exact marker.
3. Confirm the page is idle and the exact thread export contains the marked
   assistant turn.
4. Observe that the owning command continues its wait-response heartbeat and
   does not create the response file.

## Context

This delayed an otherwise clean specialist gate and required exact-thread
recovery before the merge could proceed without bypassing review evidence.
