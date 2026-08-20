---
title: 'ReviewGPT local lane count overrides explicit task value'
severity: 'minor'
---

## Expected Behavior

An explicit `REVIEW_GPT_BROWSER_LANE_COUNT=5` on a canonical review command should override a stale machine-local preference, just as the documented direct named-lane selection does.

## Current Behavior

`scripts/review-gpt.config.sh` sources the optional local preference file after reading only the direct lane name. A local `REVIEW_GPT_BROWSER_LANE_COUNT=6` therefore overwrites an explicit task value of `5`, and every ReviewGPT command fails before browser launch with the five-lane validation error. Isolating `XDG_CONFIG_HOME` works around the override but also hides unrelated CLI authentication configuration unless that configuration is restored separately.

## Possible Solution

Capture the direct lane-count value before sourcing local preferences and use it as the highest-precedence value, or source local preferences only as defaults for unset environment variables. Include the resolved source in the validation diagnostic.

## Minimal Reproducible Example

1. Put `REVIEW_GPT_BROWSER_LANE_COUNT=6` in the optional Murph ReviewGPT preference file.
2. Run `REVIEW_GPT_BROWSER_LANE_COUNT=5 pnpm --silent review:gpt pr-review --dry-run --prompt test`.
3. Observe that the resolved value is still `6` and the command rejects it before browser launch.

## Context

This blocked a required later-round audit even though the invocation supplied the repository's current five-lane limit. The task had to use an isolated temporary config root while preserving the GitHub CLI configuration separately.
