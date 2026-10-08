---
title: 'Pinned ReviewGPT cannot select its concrete model in the current ChatGPT picker'
severity: 'minor'
---

## Expected Behavior

The repository-pinned ReviewGPT command selects and verifies its configured GPT-6 Pro model before sending an implementation or review packet.

## Current Behavior

Version 0.5.152 stops before auto-send with `Draft model selection failed` and `option-not-found` for `gpt-6-pro`. The observed picker exposes GPT-6 and separate Pro/Power controls. No request is sent. This blocks the required final review gate even when an independently verified implementation-author fallback is available.

## Possible Solution

Update the supported model-selection integration and pin after verifying the composed picker interaction and response-model evidence. Do not weaken concrete-model verification or treat a draft as a completed review.

## Minimal Reproducible Example

Run the pinned CLI using the repository configuration, `--model gpt-6-pro`, a synthetic prompt, and `--wait` in an authenticated managed browser lane. Observe the pre-send selection failure.

## Context

A telemetry PR requires the existing final ReviewGPT gate. Local tests, CI, and an implementation fallback cannot establish that review result.
