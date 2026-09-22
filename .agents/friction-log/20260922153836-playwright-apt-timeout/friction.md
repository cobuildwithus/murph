---
title: 'Playwright APT timeout policy is overridden by newer runner images'
severity: 'minor'
---

## Expected Behavior

The Chromium installer should load its declared retry and timeout settings on supported GitHub Ubuntu runners before starting Playwright.

## Current Behavior

The runner image now writes its own timeout settings to apt.conf.d/zz-retries. APT reads that after Murph's 99murph-playwright, replacing the 180-second timeout with 15 seconds. The effective-policy guard stops billing and viewport CI before tests run.

## Minimal Reproducible Example

In an isolated Debian container, write an HTTP timeout of 15 to zz-retries and 180 to 99murph-playwright. apt-config reports 15. Rename the latter file to zzzz-murph-playwright; apt-config reports 180.

## Context

Observed during merge preparation for native polls on the September 20 Ubuntu runner image. The installer now orders its policy after the runner defaults and retains its effective-value guard.
