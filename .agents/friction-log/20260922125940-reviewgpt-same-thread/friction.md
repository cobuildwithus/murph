---
title: 'ReviewGPT same-thread retry stalls at a disabled send button'
severity: 'minor'
---

## Expected Behavior

A follow-up review with a confirmed attachment either submits in the managed conversation or reports an actionable staging failure promptly.

## Current Behavior

The managed review confirms the requested Pro model and uploaded archive, then waits at the send stage for ten minutes and fails with send-button-disabled. Diagnostics show no accepted request receipt or matching conversation target, and thread export times out.

## Possible Solution

Detect an unavailable same-thread composer earlier and offer the documented fresh-conversation full-audit recovery with the original round baseline preserved.

## Minimal Reproducible Example

Run the repository ReviewGPT PR preset for round two with its previous conversation URL, explicit original managed lane, full snapshot, and --wait. In the observed failure, attachment confirmation succeeds but auto-send never becomes available.

## Context

This interrupted final billing PR review after local proof. Recovery uses a fresh full review on another configured lane without treating the failed send as a completed substantive round.
