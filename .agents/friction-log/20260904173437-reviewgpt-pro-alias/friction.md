---
title: 'ReviewGPT Pro alias rejects current GPT-6 Pro response metadata'
severity: 'minor'
issue: 'cobuildwithus/murph#2880'
---

## Expected Behavior

The repository's pinned ReviewGPT command accepts a completed review from the current ChatGPT Pro model when invoked with its documented `--model pro` alias, while preserving exact-thread and response-marker verification.

## Current Behavior

The command stages and sends with Pro selected, captures the completed response, then fails because the DOM reports `gpt-6-pro` while the expected model remains the literal `pro` alias. The default concrete `gpt-5.6-sol` target also selects the current Pro model and fails that comparison. This forces existing-thread recovery after the review has already completed.

## Minimal Reproducible Example

On a prepared synthetic PR candidate, run the repository's `pnpm review:gpt pr-review --model pro --wait --response-marker REVIEW_COMPLETE` route with ChatGPT's current Pro model available. A response carrying the requested model-confirmation alias and completion marker is rejected when its DOM model identifier is `gpt-6-pro`.

## Context

The pinned ReviewGPT 0.5.143 help documents `pro` as targeting the current ChatGPT Pro model. The mismatch prevents the normal waited final-review gate from completing even when the review response is captured. Recovery should reuse the committed turn instead of sending a duplicate review. No change to Murph's runtime model support is needed to address this tooling issue.
