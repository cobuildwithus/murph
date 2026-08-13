---
title: 'ReviewGPT does not reject a review-only preset that conflicts with an implementation task'
severity: 'minor'
---

## Expected Behavior

ReviewGPT should reject a request before launch when a selected preset requires review-only output but the custom task explicitly requests an implementation patch.

## Current Behavior

The preset instruction and custom task were concatenated without conflict detection. The remote run followed the review-only constraint instead of producing the requested patch and had to be stopped after extended execution.

## Possible Solution

Validate preset constraints against the custom task before creating the remote thread, or require an explicit override when the task requests writes under a review-only preset.

## Minimal Reproducible Example

Run ReviewGPT with a review-only simplification preset and a custom task that asks it to return an implementation patch.

## Context

This was encountered while requesting a deletion-first redesign patch and required a second run without the conflicting preset.
