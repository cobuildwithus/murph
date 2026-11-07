---
title: 'Recap browser test expects obsolete not-found punctuation'
severity: 'minor'
---

## Expected Behavior

The recap browser proof should verify malformed IDs against the current shared not-found page.

## Current Behavior

The existing assertion expects `Page not found.` while the shared page heading is `Page not found`. The public route correctly returns 404, but the browser proof fails before reaching its design study.

## Minimal Reproducible Example

Run the recap Playwright spec against the current shared not-found component and navigate to `/recap/bad`.

## Context

Found during recap desktop handoff verification. The task corrects the assertion to use the current semantic heading.
