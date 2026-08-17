---
title: 'Frontend design proof treats metadata-only route edits as UI changes'
severity: 'minor'
---

## Expected Behavior

Route changes limited to Next.js metadata exports should not require a design-catalog study or desktop and mobile UI screenshots.

## Current Behavior

The frontend design-proof checker classifies every changed TSX file under `apps/web/app` as a user-facing UI change. Adding canonical or robots metadata to an otherwise unchanged page therefore fails CI unless the PR adds an unrelated catalog entry and screenshots.

## Possible Solution

Compare the rendered portion of changed route modules across the base and head revisions, excluding Next.js metadata and viewport exports plus imports used only by those exports. Continue requiring design proof when the remaining module changes.

## Minimal Reproducible Example

1. Add a `robots` value to an existing page's exported metadata without changing its rendered component.
2. Open a PR with an accurate `Design proof: Not applicable` explanation.
3. Run `node scripts/check-frontend-design-proof.mjs` against the PR base and head.
4. Observe that the checker requires a design catalog change and two screenshots.

## Context

This blocked a crawler-metadata correction that has no rendered UI or interaction change.
