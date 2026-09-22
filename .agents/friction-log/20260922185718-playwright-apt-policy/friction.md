---
title: 'Playwright APT policy check rejects equivalent option casing'
severity: 'minor'
---

## Expected Behavior

The Chromium installer should proceed when APT has loaded the configured retry and timeout values.

## Current Behavior

APT preserves an option's original spelling in its dump while resolving option names case-insensitively. A pre-existing lowercase timeout key therefore makes the installer reject the correctly overridden timeout before browser installation.

## Minimal Reproducible Example

In Ubuntu 24.04, load an earlier APT configuration containing `Acquire::http::timeout "30";`, followed by the installer's `Acquire::http::Timeout "180";`. The dump retains lowercase `timeout` with value 180, but the exact case-sensitive comparison fails.

## Possible Solution

Compare the existing exact policy lines case-insensitively and retain checks for missing options and incorrect values.

## Context

This blocks browser-based CI before product verification runs. Reproduced in an isolated Ubuntu container using synthetic configuration.
