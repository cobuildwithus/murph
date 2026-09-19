---
title: 'Dashboard smoke rendering falls back to the client after an invalid element error'
severity: 'minor'
---

## Expected Behavior

The documented hosted Web Playwright smoke environment should server-render signed-out dashboard pages without React recovery errors.

## Current Behavior

A signed-out Patterns request in the standard smoke environment returns HTTP 200 but embeds an invalid-element server-render error. Chromium recovers by rendering the dashboard on the client. This also reproduces with the unchanged auth provider from the task base, so it is independent of automatic sign-in.

## Minimal Reproducible Example

Run a Playwright request to /patterns through apps/web/playwright.config.ts using the generated smoke environment. Inspect the response for the fixed React error text: Element type is invalid. No live account or provider credentials are needed.

## Context

The fallback complicates dashboard hydration and browser regression proof. The sign-in dialog and dashboard remain usable after client recovery, but HTTP status alone misses the rendering failure.
