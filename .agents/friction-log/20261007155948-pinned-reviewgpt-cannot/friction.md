---
title: 'Pinned ReviewGPT cannot select GPT-6 from the current named model menu'
severity: 'minor'
---

## Expected Behavior

The repository's pinned ReviewGPT command should select and verify GPT-6 Pro on the supported Chat surface before staging and sending an authorized request.

## Current Behavior

With a reachable configured browser lane, the default gpt-6-pro selection exits before sending. The current picker exposes a GPT-6 model row and a separate Power control, while the pinned selector's supported navigation recognizes Latest. The implementation and final-review workflow cannot proceed. A bare Pro effort label is correctly insufficient model proof and must not be accepted as a workaround.

## Minimal Reproducible Example

Use the repository's pinned @cobuild/review-gpt 0.5.152 command and review-gpt.config.sh with an authenticated, reachable dedicated lane on the current Chat UI. Request the default gpt-6-pro model with a synthetic prompt. Observe that selection stops before send with option-not-found when the menu has GPT-6 rather than Latest.

## Possible Solution

Validate a registry-sourced selector release or a narrowly reviewed compatibility correction that recognizes the explicit GPT-6 row, selects Pro power, and still proves the resulting named model and response metadata. Preserve the existing fail-closed behavior when that proof is unavailable.

## Context

The required authoring and candidate-review gates are blocked before a request is submitted. This is a repository-pinned tooling compatibility issue; account authentication and model requirements should remain unchanged.
