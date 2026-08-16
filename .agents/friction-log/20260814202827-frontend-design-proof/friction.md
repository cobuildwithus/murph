---
title: 'Frontend design proof checker requires an undocumented list-item label'
severity: 'minor'
issue: 'cobuildwithus/murph#1857'
---

## Expected Behavior

A PR body that follows the completion guide and links the required design catalog route in its Design proof section should pass the frontend metadata check regardless of the prose label used for that link.

## Current Behavior

The checker accepts the route only when it appears inside a list item whose rendered text begins with the exact label `Design page:`. A semantically equivalent `Design catalog:` item fails even though the guide specifies the route and screenshots but not that label.

## Possible Solution

Document the required label in the completion guide or have the checker find the qualifying design route in any list item within the Design proof section.

## Minimal Reproducible Example

1. Add a `## Design proof` section.
2. Add `- Design catalog: [/design?tab=sections](https://example.test/design?tab=sections)` plus valid desktop and mobile screenshot items.
3. Run `node scripts/check-frontend-design-proof.mjs` with a frontend UI path in the PR diff.
4. Observe that the checker reports the design-page link missing.
5. Rename only `Design catalog:` to `Design page:` and observe that the route check passes.

## Context

This forced a PR-body-only retry after the required catalog implementation and hosted screenshots were already present.
