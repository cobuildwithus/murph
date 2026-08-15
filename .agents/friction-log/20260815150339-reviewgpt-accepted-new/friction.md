---
title: 'ReviewGPT accepted new conversation is not bound after send'
severity: 'minor'
---

## Expected Behavior

After a managed-browser run auto-submits a new ChatGPT conversation, the wrapper should bind the accepted `/c/` URL and continue response capture without resending.

## Current Behavior

A clean exact-head `completion-specialists --wait` run can confirm the attachment, requested model selection, and committed auto-send, then fail because it cannot prove one exact accepted conversation URL. The browser has exactly one newly accepted conversation and the response completes there, but the wrapper exits with an unknown staging result and forbids a resend. A second exact-head attempt reproduces the same failure. Manual same-lane export recovers the response text but loses the waited-send model attestation required by the review gate.

## Possible Solution

After committed auto-send, add a bounded recovery that compares the owned target set before and after submission, binds the single new authenticated `/c/` target, and resumes the existing waited capture without submitting again.

## Minimal Reproducible Example

1. Use an authenticated managed browser profile with a live CDP endpoint and no active generated response.
2. Run the repository `completion-specialists --wait` command for a clean pushed pull-request head.
3. Observe attachment readiness, requested-model selection, and committed auto-send.
4. Observe the wrapper fail to bind the accepted conversation URL while exactly one new `/c/` target contains the submitted request.
5. Export that target from the same managed lane and observe the response complete there without any second send.

## Context

This blocks attestation of a mandatory preliminary review even though browser launch, attachment upload, send, and response generation all succeed. Retrying consumes another model run but does not improve the transport evidence.
