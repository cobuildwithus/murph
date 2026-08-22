---
title: 'ReviewGPT can commit a turn after its staged ZIP disappears'
severity: 'minor'
---

## Expected Behavior

After ReviewGPT reports that an audit ZIP is staged, the exact committed user turn retains that attachment and the response capture can verify it.

## Current Behavior

On separate managed-browser lanes, ReviewGPT 0.5.131 reported successful ZIP staging but the exact committed turn contained no attachment. The runner correctly refused to resend automatically, so the required current-head audit could not complete. A separate fresh-lane attempt timed out during CDP staging retries.

## Possible Solution

Re-verify the draft attachment immediately before committing. If it disappeared, fail before send or perform one bounded re-stage attempt while preserving the exact-turn and duplicate-send protections.

## Minimal Reproducible Example

1. Prepare a synthetic audit ZIP and start a waited ReviewGPT run with file attachment and response capture enabled.
2. Let the runner report successful staging and commit the draft.
3. Inspect the exact committed user turn and capture metadata; the turn can contain zero artifacts even though staging succeeded.

## Context

This blocks the required exact-head review gate after the package upgrade and forces a new browser lane because the committed turn cannot be resent safely.
