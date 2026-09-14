---
title: 'Vercel source preview exceeds the repository file-count limit without archive mode'
severity: 'minor'
---

## Expected Behavior

The documented source-preview path should upload this monorepo without an avoidable rejected request.

## Current Behavior

The default Vercel deployment upload exceeds its per-request file count for the current repository. Retrying with archive mode is required before the preview build can queue.

## Possible Solution

Document archive mode in the repository's preview command or provide a scoped preview wrapper that selects it by default.

## Minimal Reproducible Example

From a linked task checkout, run `vercel deploy --yes --target preview --no-wait`. The upload exceeds 15,000 entries. Repeat with `--archive=tgz` to queue the same source preview successfully.

## Context

A small Ops confirmation change needed a reviewer-openable synthetic design preview. Upload admission failed before any build work began, requiring a second source upload.
