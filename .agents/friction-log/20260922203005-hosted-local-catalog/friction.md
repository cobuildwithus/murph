---
title: 'Hosted-local catalog setup requires retired GPT-5.4 smoke templates'
severity: 'minor'
---

## Expected Behavior

Hosted-local E2E should start with the pinned Codex catalog and the current GPT-6 launch supplement. The deploy smoke already selects GPT-6 Sol.

## Current Behavior

Catalog preparation still synthesizes an obsolete GPT-5.4 Nano smoke entry from GPT-5.4 Mini. Codex 0.155.1 no longer bundles that template, so all protected hosted-local E2E scenarios stop during setup even though the final production image smoke passes.

## Minimal Reproducible Example

Use the pinned Codex 0.155.1 bundled catalog without GPT-5.4 Mini/Nano and start the hosted-local stack. Catalog preparation fails before any scenario runs. The focused stack fixture reproduces the same failure when those obsolete entries are removed.

## Possible Solution

Delete the retired Nano synthesis path and its template requirement. Keep current product-model validation and the official GPT-6 supplement.

## Context

Discovered by the protected predeployment E2E gates after PR 3649; production runtime deployment was not attempted.

After the catalog setup was repaired, the scheduled image-reminder journey completed with Sol and the GPT-6 pricing version, but its billing assertion still expected the GPT-5.6 pricing version. Keep the fixture's standard and Flex version assertions aligned with the selected model's published pricing contract; retain the cost and adjustment assertions.
