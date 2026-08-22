---
title: 'Changelog page test pins a historical edition to the first page'
severity: 'minor'
---

## Expected Behavior

Adding a valid independent dated changelog fragment should keep the generic archive-page proof green as editions naturally paginate.

## Current Behavior

The archive-page test requires the 2026-08-10 historical edition to remain in the first seven editions. Adding the next valid edition moves it to page two and fails the otherwise generic current-page test.

## Possible Solution

Keep current-page rendering assertions data-driven and leave historical summary assertions in the dedicated changelog registry coverage.

## Minimal Reproducible Example

1. Add one valid fragment under the next chronological entries date.
2. Generate changelog fragments.
3. Run the focused changelog fragment, registry, and page tests.
4. Observe the current-page test fail because the historical edition is no longer on page one.

## Context

This blocks the documented independent-fragment workflow as the archive grows.
