---
title: 'Changelog archive test pins a corrected edition to the first page'
severity: 'minor'
---

## Expected Behavior

Adding a dated changelog fragment should pass the focused changelog page suite without editing historical inventory assertions, as required by the changelog authoring guide.

## Current Behavior

The archive test searches only the current first-page editions for the fixed 2026-08-10 corrected edition. Adding the first 2026-08-17 fragment moves that edition to page two, so the test fails before it can validate the new fragment. The authoring guide simultaneously says an ordinary fragment PR must not edit the latest-page inventory test.

## Possible Solution

Resolve the corrected historical edition from the complete changelog registry, or assert it on whichever archive page currently owns it, while keeping the first-page rendering assertions derived from the current page projection.

## Minimal Reproducible Example

1. Start from main with dated fragments through 2026-08-16.
2. Add a valid entry under apps/web/changelog/entries/2026-08-17.
3. Run pnpm --dir apps/web test:prepared -- test/changelog-page.test.tsx.
4. Observe that renders the current archive window with compact older navigation fails because 2026-08-10 is no longer in firstPage.editions.

## Context

The fragment generator succeeds. Repository guidance prevents the ordinary item PR from updating the brittle inventory assertion, leaving the focused suite red for a valid new date.
