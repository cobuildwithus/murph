---
title: 'ReviewGPT same-thread retry stalls at a disabled send button'
severity: 'minor'
issue: 'cobuildwithus/murph#3873'
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

## Resolution

A current reproduction of the confirmed-attachment, disabled-send symptom
established that an informational attachment-success dialog intercepts the
composer. Upstream [ReviewGPT PR #10](https://github.com/cobuildwithus/review-gpt/pull/10)
handles only that verified notice, including when it appears during send
readiness, and rechecks the attachment afterward. Other dialogs remain blocked.
The combined source received a fresh complete review in
[ReviewGPT PR #11](https://github.com/cobuildwithus/review-gpt/pull/11).

Murph pins release 0.5.151. Installed-package controls exercise the exported
notice handler and reject mismatched attachments and additional decisions.
The composed upstream CLI proof retained the draft and attachment, dismissed
only the informational notice, and restored send readiness without submitting.
This does not establish the missing historical attempt's precise cause; it
repairs the independently reproduced current staging defect without changing
timeouts, sending a duplicate request or weakening acceptance gates.
