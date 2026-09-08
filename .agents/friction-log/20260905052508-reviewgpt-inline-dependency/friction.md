---
title: 'ReviewGPT inline dependency context fails during prompt prefill'
severity: 'minor'
issue: 'cobuildwithus/murph#2945'
---

## Expected Behavior

The canonical ReviewGPT command should stage supported prompt-file supplements alongside the guarded repository snapshot, or return an actionable failure with exact target ownership for cleanup.

## Current Behavior

Two canonical invocations using exact installed dependency source supplements failed at the prompt-prefill stage in CDP Runtime.evaluate. The attempts used different configured review lanes and prompts of approximately 169,000 and 63,000 characters. The canonical tool exhausted three staging tries with socket-disconnect retries and a Runtime.evaluate command timeout. Neither attempt produced an accepted user turn or an exact owned target identifier. A subsequent supported packet using a smaller exact-source supplement reached Send and response wait; this correlation does not establish causation. The root cause has not been isolated; prompt length alone is not established as the cause.

## Possible Solution

Diagnose the staging error at the existing browser command owner. Preserve supported packet delivery, exact target ownership, and failure diagnostics without weakening review context requirements.

## Minimal Reproducible Example

Prepare a guarded full repository review snapshot, supply exact installed dependency source through the supported prompt-file option, and run the canonical waited review command. Inspect the invocation-owned stage log when prompt-prefill fails in Runtime.evaluate before an accepted turn.

## Context

Dependency patches require source context beyond the guarded repository snapshot, which excludes installed dependencies. The observed failure forced the review packet to use bounded verbatim owner spans. No private prompt contents or browser identifiers are needed to describe the failure.
