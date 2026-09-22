---
title: 'Playwright installer rejects loaded APT policy with preserved key casing'
severity: 'minor'
---

## Expected Behavior

The Chromium installation wrapper accepts the required numeric retry and timeout values when APT reports equivalent configuration keys with different capitalization.

## Current Behavior

The required hosted billing CI job stops before tests because apt-config dump preserves a lowercase timeout key while the wrapper expects Timeout. APT successfully resolves the required value through its configuration query API.

## Possible Solution

Compare the fixed numeric policy lines without case sensitivity and retain fail-closed checks for missing or incorrect values.

## Minimal Reproducible Example

On Linux, create a temporary APT configuration with Acquire::http::timeout set to 30. Override Acquire::http::Timeout to 180 using apt-config -o. The dump prints the lowercase key with value 180; the current case-sensitive comparison rejects it.

## Context

This blocks Chromium setup in required Stripe billing proof before application tests run.
