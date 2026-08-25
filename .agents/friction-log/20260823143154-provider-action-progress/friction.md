---
title: 'Provider action retries can hide the failing authorization phase'
severity: 'major'
issue: 'cobuildwithus/murph#2186'
---

## Expected Behavior

An unattended provider action is submitted once, then either produces bounded
progress or fails with the runner's redacted authorization phase and surface.

## Current Behavior

The wearable browser loop treated any successful click call as progress even
when the provider stayed on the same confirmation state. It clicked the same
positive action repeatedly, reset its blocked-action timer after every click,
and outlived the parent process timeout. CI therefore reported only an opaque
child `SIGTERM` instead of the owned browser phase.

## Possible Solution

Make provider submissions one-shot per proven state and require a bounded state
transition before allowing another action. Keep the parent timeout outside the
child's maximum journey plus cleanup budget so redacted child failures remain
observable.

## Minimal Reproducible Example

1. Present a positive confirmation action on a stable provider URL.
2. Make its click resolve without changing the route.
3. Run the unattended authorization loop and observe repeated clicks until the
   parent kills the browser child.

## Context

This delayed every protected canary and erased the exact failure phase needed
to distinguish provider UI drift from callback or cleanup failures.
