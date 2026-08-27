---
title: 'Detached ReviewGPT wake rejects a captured thread with zero user turns'
severity: 'minor'
issue: 'cobuildwithus/murph#2429'
---

## Expected Behavior

After a tool-owned ReviewGPT response capture times out, the detached wake should resolve the committed initiating turn and resume the owning session when the review is complete.

## Current Behavior

The review can complete externally, but detached wake refuses the persisted turn identity because it resolves to zero user turns. The owning task must discard that review run and perform a fresh same-pass tooling retry.

## Possible Solution

Persist and validate the initiating user-turn identity when the review starts, or recover it from the committed capture metadata before arming wake.

## Minimal Reproducible Example

1. Start a ReviewGPT pass with tool-owned wait capture.
2. Let response capture reach its timeout after the external review finishes.
3. Arm detached thread wake for the returned conversation.
4. Observe that wake rejects the captured identity as resolving to zero user turns.

## Context

This wastes an expensive review run and delays PR completion even though the external response exists. A fresh retry succeeds, so product code is unaffected.
