---
title: 'ReviewGPT cannot capture a submitted review with a WEB-prefixed conversation URL'
severity: 'minor'
---

## Expected Behavior

After the repository review command submits an attached audit, retain the exact owned conversation and continue response capture, or provide a supported recovery command without resending.

## Current Behavior

The command reports that auto-send committed but it cannot prove one accepted conversation URL. The owned browser page contains the exact submitted review and shows Pro thinking at a `/c/WEB:<uuid>` URL. The waited command exits before capturing a response.

## Possible Solution

Teach the review package to distinguish an accepted transient conversation from an unsent draft and preserve enough exact-target metadata to resume capture safely.

## Minimal Reproducible Example

Run `pnpm --silent review:gpt pr-review --wait` on an eligible synthetic PR. If ChatGPT retains the submitted turn at a WEB-prefixed conversation URL, the review wrapper exits after submission instead of waiting.

## Context

The required review gate is unavailable despite successful staging and submission. Retrying by resending could duplicate an accepted audit. No production data or credentials are required to reproduce the browser URL handling issue.

Recovery succeeded after the transient URL resolved: exporting the same exact conversation captured the completed audit. The caller still had to recover and attest the result manually because the original waited process had already exited.
