---
title: 'ReviewGPT minimum duration flag skips verified model responses'
severity: 'minor'
issue: 'cobuildwithus/murph#2903'
---

## Expected Behavior

The repository review command should enforce its documented 270-second response minimum for every marked concrete-model final review, or report a failed timing gate for parent disposition.

## Current Behavior

The wrapper passes --minimum-marked-response-time 270s, but the installed review tool returns success for shorter responses when compatible model metadata exists. Its markedResponseDurationFailure helper returns early when hasConcreteModelEvidence is true. The repository policy still requires the duration floor, so a successful capture can remain invalid and require another review.

## Possible Solution

Align the repository timing gate with the capture tool contract without weakening the review requirement. Preserve enough invocation-owned submission and completion metadata to validate elapsed time directly.

## Minimal Reproducible Example

1. Run a waited review through the canonical repository command with a required completion marker.
2. Capture a concrete-model response before the configured response minimum.
3. Compare the invocation-owned send/wait timestamps with response capture time.
4. Observe a successful tool exit even though the repository duration gate has not passed.

## Context

This reproduced in two independent repair reviews. Parent timing verification rejected both captures and required same-round retries. No private review content is needed to reproduce or diagnose the enforcement mismatch.
