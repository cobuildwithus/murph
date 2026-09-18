---
title: 'Hosted release fixtures retain retired engagement and idle-timeout contracts'
severity: 'minor'
---

## Expected Behavior

Hosted release scenarios should exercise the current runner configuration contract and prove that system work continues without recent messaging engagement.

## Current Behavior

The fast non-starvation fixture supplies a 1 ms idle timeout below the runtime's 1000 ms minimum, so setup fails before fairness assertions. The Temporal fixture waits for a global messaging-engagement block that the runtime no longer applies, timing out before retention and frontier ownership proof.

After those corrections, the fairness observer still requires the retired runner admission log instead of the container invocation event emitted by the current owner. The media fixture also gives the runner a five-minute idle period while its completion helper times out after three minutes.

## Minimal Reproducible Example

Run the hosted-local Temporal orchestration and Linq reminder/device-sync non-starvation scenarios with the fast gate enabled against current runtime contracts and synthetic members.

## Possible Solution

Use the minimum supported test timeout. Exercise inactive-account retention with an explicit paused billing state, and require system frontiers to advance for members without recent inbound messages. Preserve the no-provider-turn, unconsumed mailbox, pointer retirement, and retention completion checks.

Count distinct write-fence attempts from actual container invocation events, preserving the complete observation window and ignoring readiness-only events. Keep the media fixture's idle checkpoint inside its completion deadline; explicit provider barriers continue to hold detached image work.

## Context

These stale proof preconditions block full worker release integration even though the intended runtime behavior is already deployed.
