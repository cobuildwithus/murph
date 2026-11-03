---
title: 'Review packets include SVG images outside the binary asset exclusions'
severity: 'minor'
---

## Expected Behavior

Text-only review packets exclude all image files, including vector artwork and nested assets.

## Current Behavior

The canonical package exclusions cover selected raster asset directories, but SVG icons and other nested image paths remain in both lean and full archives.

## Minimal Reproducible Example

Build the canonical full audit ZIP, then inspect its entry names. The archive includes apps/web/app/icon.svg and SVG brand assets.

## Context

This violates the text-only review constraint. Add image-extension exclusions to the shared owner and verify both archive variants contain no image entries before upload.
