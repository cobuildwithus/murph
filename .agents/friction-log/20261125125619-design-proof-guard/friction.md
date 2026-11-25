---
title: 'Design-proof guard asks for a Web design page when a PR adds images only the native app loads'
severity: 'minor'
---

## Expected Behavior

A pull request that adds static images under `apps/web/public/` which no hosted Web page renders can state that in the PR body and pass the design-proof check without linking a Web design page.

## Current Behavior

`scripts/check-frontend-design-proof.mjs` treats every changed image under `apps/web/public/` as hosted Web UI. The PR must carry a `## Design proof` section whose `Design page` item links `/design` or `/screenshots/<category>` with a fragment, even though no page on either route renders the new files. The author links a study of an unchanged Web surface to satisfy the shape check.

## Possible Solution

Accept a stated reason in place of the design page link when the changed images are served only to a native client, or let a PR name the files as not rendered by hosted Web.

## Minimal Reproducible Example

1. Add `apps/web/public/example-native-only/tile.png` and reference it only from a JSON route response read by the native app.
2. Open a pull request without a `## Design proof` section.
3. The `Require structured frontend design proof` step fails and asks for a design page link.

## Context

Met while adding square provider logos that only the companion app loads. The Web pages that show provider logos were unchanged, so the linked study proves no regression but cannot show the new files.
