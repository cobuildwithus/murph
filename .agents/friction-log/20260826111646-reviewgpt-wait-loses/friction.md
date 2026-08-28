---
title: 'ReviewGPT wait loses completed responses and wake relaunches into active owners'
severity: 'major'
issue: 'cobuildwithus/murph#2493'
---

## Expected Behavior

A required ReviewGPT wait should return the completed response to its owning
Codex session exactly once. If recovery uses thread wake, it should detect that
the owner session is already active and deliver the response without launching
a nested Codex process.

## Current Behavior

One exact-head review completed in the browser but the normal capture remained
active for roughly four hours without returning the response. The documented
thread-wake recovery exported the exact response, then attempted a child Codex
relaunch that failed because the owning session was already active. Manual
artifact inspection was required to continue the review gate.

## Possible Solution

Make the wait path persist and surface the completed response before browser
teardown, and make thread wake deliver to an active owner without invoking
another Codex process. Preserve one completion owner and idempotent response
capture.

## Minimal Reproducible Example

1. Start a required exact-head ReviewGPT wait from an active Codex session.
2. Let the browser conversation finish while the wait target fails to return
   the response.
3. Run the documented thread-wake recovery for that thread.
4. Observe the response export succeed and the nested Codex relaunch fail
   against the already-active owner.

## Context

This blocked a production incident fix behind a completed review, consumed
several hours, and made the canonical recovery command unable to resume its
actual owning session.
