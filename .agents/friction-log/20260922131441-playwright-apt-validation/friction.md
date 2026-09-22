---
title: 'Playwright apt validation rejects a correctly loaded mixed-case timeout'
severity: 'minor'
---

## Expected Behavior

The CI installer should keep its configured retry and timeout values and invoke Playwright.

## Current Behavior

Apt preserves the spelling of an existing option while applying a later value. The installer compares the dump case-sensitively and exits before browser proof even though the effective timeout is correct.

## Possible Solution

Remove the redundant dump-format guard; preserve the policy write, privileged command failure handling and workflow timeout.

## Minimal Reproducible Example

In Ubuntu, set Acquire::http::timeout to 30 in an earlier configuration file, then set Acquire::http::Timeout to 180 in the later policy. Read the effective option and run the existing installer. It rejects the output spelling despite the effective value.

## Context

Reproduced in an isolated Ubuntu container. The correction lets the one Playwright invocation run and preserves its nonzero exit status.
