---
title: 'Foreground priority E2E arms an obsolete canonical checkpoint barrier'
severity: 'minor'
issue: 'cobuildwithus/murph#2724'
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

## Follow-up: independent Environment ownership

The default-prefix fixture also expected its snapshot-start barrier to be entered
by a default invocation. Current reconciliation deliberately selects independent
model-free Environment work behind that earlier row, so the system-mailbox
invocation enters the barrier while the fixture waits for the wrong mode until
snapshot start times out. Expect the current system-mailbox owner and explicitly
assert that the held handled-through sequence remains below the earlier row.
Keep the unchanged replica and no-extra-provider-request assertions.

## Follow-up: seeded recovery with newly appended work

A local replay passed foreground admission and checkpoint ordering but rejected successful continuation because a seeded member action appended a follow-up wake. Both imported frontiers covered the seed and a successful post-provider processing record existed, while the new wake made total lane lag nonzero. Require the seeded frontiers, no retryable block, and attributed post-provider processing without requiring subsequently generated work to finish. Preserve the exact fence and standby checks at provider start.
