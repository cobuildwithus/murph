---
title: 'ReviewGPT same-thread wait can accept a prior completion marker'
severity: 'minor'
---

## What happened

A same-thread implementation follow-up used a response marker that also appeared in the preceding assistant response. The waited command exited after detecting the prior marker, then rejected it only because the prior response was under the minimum trusted-duration check. Thread export confirmed no assistant turn existed after the newest user message.

## Expected

Response capture should scope marker matching to an assistant turn created after the current prompt send and should not treat an earlier assistant response as completion.

## Reproduction

1. Complete a waited same-thread run with a marker.
2. Send a follow-up on the same thread using the same marker.
3. Observe that capture may match the earlier response before a new assistant turn exists.

## Impact

The caller can receive a false terminal result and may mistake a stale implementation artifact for the requested follow-up. Thread export is required to disambiguate.
