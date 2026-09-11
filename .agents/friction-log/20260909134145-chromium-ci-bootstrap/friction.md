---
title: 'Chromium CI bootstrap fails on an unrelated Chrome package index'
severity: 'minor'
issue: 'cobuildwithus/murph#3112'
---

## Expected Behavior

The repository Chromium bootstrap should install Playwright's required operating-system dependencies without depending on unrelated third-party package indexes bundled into a hosted runner image.

## Current Behavior

The viewport workflow repeatedly stops during dependency installation when the Chrome APT repository publishes inconsistent package-index hashes. Browser tests never start, including on a retry of the same candidate.

## Possible Solution

Keep dependency installation scoped to the distribution repositories required by Playwright. Avoid refreshing unrelated third-party indexes during browser-test setup.

## Minimal Reproducible Example

1. Run the repository viewport workflow on a hosted Ubuntu runner whose image includes the third-party Chrome APT repository.
2. During an inconsistent index publication, invoke `scripts/install-playwright-chromium.sh`.
3. Dependency installation fails before Chromium download or the viewport assertions run.

## Context

This produces a failed browser check for backend-only candidates despite the failure occurring entirely in dependency bootstrap. A same-head retry reproduced the failure; no application source change was involved.
