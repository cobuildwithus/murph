---
title: 'Wearable browser cleanup erases authorization failure context'
severity: 'minor'
---

## Expected Behavior

A failed synthetic authorization click retains its fixed action category, timeout category, and content-free location evidence after browser cleanup.

## Current Behavior

The browser runner reads its page location after closing the browser and appends a cleanup suffix to the original failure stage. The click wrapper reduces every timeout to the same message, so distinct authorization actions cannot be distinguished.

## Minimal Reproducible Example

Make an approved synthetic authorization control throw a TimeoutError, then make the fake browser return an unavailable location during close. Observe that the reported stage and location describe cleanup rather than the failing operation.

## Context

This prevents focused diagnosis of the repository-owned wearable browser verification harness. No provider content or live account evidence is needed to reproduce it.
