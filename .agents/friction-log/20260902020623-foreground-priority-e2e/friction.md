---
title: 'Foreground priority E2E arms an obsolete canonical checkpoint barrier'
severity: 'minor'
---

## Expected Behavior

The real foreground-priority E2E should deterministically hold a checkpoint publication that the current shared system-mailbox path always reaches before injecting foreground work.

## Current Behavior

After background canonical checkpoint coalescing, one Environment item can defer its canonical status checkpoint into the idle snapshot. The E2E still armed only the old canonical-commit request, so the real work could finish normally while the test waited 90 seconds for a barrier that was never entered.

## Possible Solution

Arm the existing idle-checkpoint publication barrier directly for this scenario and remove the wrapper that hides which concrete boundary is under test.

## Minimal Reproducible Example

1. Run the foreground-reply-priority hosted-local E2E against the current public tree.
2. Let the Environment system-mailbox item take the coalesced checkpoint path.
3. Observe the item import, processing, and idle snapshot complete while the canonical-only test barrier remains armed.
4. Observe the test fail before it sends the foreground webhook.

## Context

This produced repeated false cross-repository rollout failures and obscured whether the owner-release regression was actually exercised.
