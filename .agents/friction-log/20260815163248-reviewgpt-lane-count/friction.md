---
title: 'ReviewGPT lane-count preference can override the supported repo cap'
severity: 'minor'
---

## What happened

The ReviewGPT command rejected `REVIEW_GPT_BROWSER_LANE_COUNT` before packaging or sending a review because the effective value was `5`, outside the supported range of 1 to 4. An explicit command environment value of `4` was still overwritten by the optional local preference.

## Expected behavior

An explicit supported command value should take precedence over an optional local preference, or preference loading should validate and clamp or reject the unsupported value at its source.

## Reproduction

Set the local ReviewGPT lane-count preference to `5`, then invoke the PR review command with `REVIEW_GPT_BROWSER_LANE_COUNT=4`. The command reports that the lane count must be an integer from 1 to 4.

## Impact

Review polling cannot start, and the generic validation error obscures that an optional local preference replaced the explicit supported command value. No prompt was packaged or sent in the observed failure.

## Workaround

Run the command with an isolated empty `XDG_CONFIG_HOME` and an explicit supported lane count. This preserves repository defaults without changing the user-wide preference.
