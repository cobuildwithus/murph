---
title: 'ReviewGPT default Pro alias rejects current backend attestation'
severity: 'minor'
---

## Expected Behavior

The repository review configuration should select a supported Pro model and
validate the resulting response against the same model identity.

## Current Behavior

The configured gpt-5.6-sol alias can select the current GPT-6 Pro interface,
while the pinned capture code still expects the older backend identity. A
completed review then fails model validation and requires exact-thread recovery.

## Possible Solution

Align the reviewed package's model selection and attestation mapping with the
repository configuration. An explicit gpt-6-pro invocation currently completes
with matching response metadata; preserve strict validation and avoid duplicate
submissions when recovering an already accepted review.

## Minimal Reproducible Example

On a clean synthetic PR, run the ordinary scripts/review-gpt.config.sh-backed
pr-review command with its default model, then compare the selected model and
capture validation. Repeat with an explicit --model gpt-6-pro target.

## Context

The required completion gate needed an additional review attempt solely because
of model identity disagreement. This concerns the repository's configured tool
integration and does not require changing product runtime behavior.
