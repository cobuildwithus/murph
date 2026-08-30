---
title: 'Viewport-overflow Playwright deadlines expire during cold startup'
severity: 'minor'
---

## Expected Behavior

The focused viewport-overflow Playwright command starts its owned hosted Web
server and reaches the health endpoint within the configured 240-second
readiness window.

## Current Behavior

A cold focused run can spend nearly the full server window in the documented
generated prerequisites and Next configuration discovery. Twice in succession,
Next printed that it was ready immediately after Playwright reported the
240-second Web-server timeout. Once the prerequisites were warm enough to reach
the browser, the first calendar-route compilation then exhausted the focused
test's original 120-second limit. No layout assertion ran in either case.

## Possible Solution

Prepare generated prerequisites before starting the readiness timer, and give
focused public-route assertions enough time for the first development compile.

## Minimal Reproducible Example

Run the focused calendar viewport test through the existing Playwright
configuration in a secondary task worktree with an isolated port and dist
suffix. On a cold run, observe Playwright time out waiting for the health URL as
Next reports ready just after the deadline. On a partially warm run, observe
the first route compile consume the original focused-test deadline.

## Context

This delayed required responsive proof and required a longer focused-test
deadline. The application route and viewport assertion were not implicated.
