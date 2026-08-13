---
title: 'Waited ReviewGPT can stay alive after writing a completed response'
severity: 'minor'
---

## Expected Behavior

A waited ReviewGPT run should exit promptly after it writes a marker-complete response and model-verification artifact.

## Current Behavior

A review wrote both completed artifacts, then the local wrapper remained asleep for more than twenty minutes without changing either artifact or emitting output. The exact task-owned session had to be interrupted before the completed response could be consumed under the no-partial-output rule.

## Possible Solution

After completed response artifacts are persisted, bound every remaining cleanup step and explicitly close or unref browser websocket handles so they cannot keep the Node process alive.

## Minimal Reproducible Example

1. Run a full PR audit with `--wait`, a required completion marker, and a response file.
2. Let the review finish and verify that the response and model-verification artifacts are both written.
3. Observe that the wrapper remains alive and idle long after the bounded target-cleanup period.

## Context

This delayed a required PR review gate even though the model work and evidence capture had completed successfully.
