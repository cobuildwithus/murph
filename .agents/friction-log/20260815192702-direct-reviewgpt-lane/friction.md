---
title: 'Direct ReviewGPT lane-count override loses to local config'
severity: 'minor'
---

## Expected Behavior

A direct `REVIEW_GPT_BROWSER_LANE_COUNT=4` value on the current invocation should take precedence over the optional user-local ReviewGPT preferences file, matching the direct browser-lane precedence rule.

## Current Behavior

`scripts/review-gpt.config.sh` captures the direct browser lane before sourcing the local preferences file, but does not preserve the direct lane-count value. A stale or invalid local lane-count therefore overrides a valid per-invocation value and stops both preliminary and final PR review commands after exact-head preflight.

## Possible Solution

Capture the direct lane-count value before sourcing local preferences and resolve it first when computing `review_gpt_browser_lane_count`.

## Minimal Reproducible Example

With an invalid lane count in the optional local preferences file, run a PR review dry run with `REVIEW_GPT_BROWSER_LANE_COUNT=4`. The wrapper rejects the resulting value instead of honoring the direct override.

## Context

This forced PR review work to isolate the optional ReviewGPT config while separately retaining GitHub CLI configuration. The workaround delayed both required exact-head review lanes and is reproducible in the repository wrapper.
