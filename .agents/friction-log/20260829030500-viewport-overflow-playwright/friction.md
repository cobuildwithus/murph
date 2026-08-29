---
title: 'Viewport-overflow Playwright server deadline expires during cold startup'
severity: 'minor'
---

## Expected Behavior

The focused viewport-overflow Playwright command starts its owned hosted Web
server and reaches the health endpoint within the configured 240-second
readiness window.

## Current Behavior

A cold focused run can spend nearly the full window in the documented generated
prerequisites and Next configuration discovery. Twice in succession, Next
printed that it was ready immediately after Playwright reported the 240-second
Web-server timeout, so no browser assertion ran.

## Possible Solution

Prepare generated prerequisites before starting the readiness timer, or give
this repository-owned Web startup lane a timeout that covers the measured
cold-start path.

## Minimal Reproducible Example

Run the focused calendar viewport test through the existing Playwright
configuration in a secondary task worktree with an isolated port and dist
suffix. Observe Playwright time out waiting for the health URL as Next reports
ready just after the deadline.

## Context

This delayed required responsive proof and forced a separately owned server
startup with a longer readiness window. The application route and viewport
assertion were not implicated.
