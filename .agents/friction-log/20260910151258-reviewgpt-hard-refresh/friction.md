---
title: 'ReviewGPT hard-refresh capture fails although exact-thread export succeeds'
severity: 'minor'
---

## Expected Behavior

The repository's waited final-review command should recover a completed response from its exact accepted request after a transient browser refresh failure, preserving model and response identity checks.

## Current Behavior

With the pinned ReviewGPT 0.5.145 toolchain, a waited review accepted the guarded snapshot and request, then failed during its timed hard refresh. A subsequent thread export with the original capture metadata recovered the completed response from the same target and accepted user turn. Its response model metadata was available and its completion marker was present.

## Possible Solution

Add or document a bounded exact-metadata export recovery before suggesting another model review. Keep the original capture owner, model checks, response minimum, and task-owned target cleanup.

## Minimal Reproducible Example

1. Start the documented final review command with a response file and wait enabled.
2. When the automatic refresh cannot restore the accepted thread, retain the emitted capture metadata.
3. Use the documented thread export command with that same metadata and browser endpoint.
4. Compare the accepted turn identity and completed response model metadata; in the observed failure, this export succeeded without sending another request.

## Context

This forced manual recovery in a PR completion workflow after the code checks had passed. The actionable boundary is the repository's pinned review toolchain and recovery runbook. No provider transcript, private URL, local identity, or credentials are needed in this report.
