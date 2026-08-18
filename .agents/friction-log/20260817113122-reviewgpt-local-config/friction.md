---
title: 'ReviewGPT local config overrides valid per-run lane count'
severity: 'minor'
---

## Expected Behavior

A valid per-run `REVIEW_GPT_BROWSER_LANE_COUNT` should override an obsolete local preference, or validation should identify the local preference that won.

## Current Behavior

`scripts/review-gpt.config.sh` sources the optional local config after capturing process environment values. A stale out-of-range lane count from that file replaces a valid explicit value and every review exits with the same generic integer-range error before opening a browser.

## Possible Solution

Load local defaults only for unset values, or validate the local value at load time and report its source so a per-run override remains authoritative.

## Minimal Reproducible Example

1. Put an out-of-range lane count in the optional ReviewGPT local config.
2. Run a PR review with `REVIEW_GPT_BROWSER_LANE_COUNT=5`.
3. Observe that the repository config replaces the valid invocation value and rejects the run before browser launch.

## Context

This caused two required exact-head review stages and their explicit valid-value retry to stop before prompt submission. The task had to hide the optional local config through an isolated config directory to continue.
