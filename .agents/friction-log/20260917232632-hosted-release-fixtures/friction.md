---
title: 'Hosted release fixtures retain retired engagement and idle-timeout contracts'
severity: 'minor'
---

## Expected Behavior

Hosted release scenarios should exercise the current runner configuration contract and prove that system work continues without recent messaging engagement.

## Current Behavior

The fast non-starvation fixture supplies a 1 ms idle timeout below the runtime's 1000 ms minimum, so setup fails before fairness assertions. The Temporal fixture waits for a global messaging-engagement block that the runtime no longer applies, timing out before retention and frontier ownership proof.

## Minimal Reproducible Example

Run the hosted-local Temporal orchestration and Linq reminder/device-sync non-starvation scenarios with the fast gate enabled against current runtime contracts and synthetic members.

## Possible Solution

Use the minimum supported test timeout. Exercise inactive-account retention with an explicit paused billing state, and require system frontiers to advance for members without recent inbound messages. Preserve the no-provider-turn, unconsumed mailbox, pointer retirement, and retention completion checks.

## Context

These stale proof preconditions block full worker release integration even though the intended runtime behavior is already deployed.
