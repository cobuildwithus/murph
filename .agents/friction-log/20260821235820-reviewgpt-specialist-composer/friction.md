---
title: 'ReviewGPT specialist composer keeps Send disabled after confirmed ZIP'
severity: 'minor'
target: 'cobuildwithus/review-gpt'
---

## Expected Behavior

A waited completion-specialists run with an exact-head ZIP and a prompt below the repository byte cap should confirm the attachment, enable Send, submit once, and begin response capture.

## Current Behavior

Two managed browser lanes confirmed one ready ZIP attachment and prefilled a prompt below the 6,500-byte repository cap, but Auto-send ended with send-button-disabled after the draft timeout. No review was submitted and each invalid attempt consumed roughly ten minutes.

## Possible Solution

Make draft validation expose the concrete reason Send remains disabled after the attachment reports ready. If composer-added wrapper text participates in a separate limit, include that serialized size in preflight and keep the canonical preset below the effective UI threshold.

## Minimal Reproducible Example

1. Run the waited completion-specialists preset against a clean exact pushed PR head.
2. Let the managed browser confirm the single ZIP attachment as ready.
3. Observe that the prompt is prefilled but Send remains disabled until draft staging fails.
4. Retry on another signed-in managed lane and observe the same terminal status.

## Context

This blocks the mandatory preliminary coverage review even though PR packaging, attachment readiness, model selection, local verification, and exact-head checks all pass.
