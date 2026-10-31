---
title: 'ReviewGPT GPT-6 Pro selection rejects the GPT-6 Power picker'
severity: 'minor'
issue: 'cobuildwithus/murph#4314'
---

## Expected Behavior

The repository's pinned ReviewGPT client selects the required GPT-6 Pro model in the current ChatGPT picker and sends the exact-head review.

## Current Behavior

Draft staging exits before sending because model selection returns option-not-found. The current picker exposes a GPT-6 family and a separate Power control, but the pinned 0.5.154 client does not complete selection in the affected managed profile. This prevents the required independent review despite passing local checks.

## Possible Solution

Verify and update the protected ReviewGPT tooling against the current family-and-Power picker contract in a separate tooling change. Preserve sent-request model evidence and never downgrade the requested model.

## Minimal Reproducible Example

From a clean, pushed, eligible PR with its evidence body complete, run the repository's ordinary round-one `pnpm review:gpt pr-review --wait` command with GPT-6 Pro configured. Use a managed profile exposing the current family-and-Power picker. Observe failure before auto-send; no substantive review round is produced.

## Context

Encountered while reviewing the private game-image delivery change. An alternate existing managed profile can be tried without restarting or modifying shared browser processes. No member data or credentials are needed to reproduce the picker incompatibility.
