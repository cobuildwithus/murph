---
title: 'ReviewGPT full snapshots include image assets outside binary exclusions'
severity: 'minor'
issue: 'cobuildwithus/murph#4514'
---

## Expected Behavior

The guarded source-review archive should support a text-only review without including image files or image payloads, including media inside nested archives.

## Current Behavior

The binary exclusion list in scripts/repo-tools.config.sh covers selected raster paths but does not exclude all images. The canonical full snapshot can still contain SVG, ICO, AVIF and raster assets outside those paths. Auto-send can submit that archive before the caller inspects its inventory.

## Possible Solution

Add an explicit text-only packaging policy with an archive-inventory check before upload. Keep required source and exact-head review metadata, reject nested archives, and make excluded media counts visible before submission.

## Minimal Reproducible Example

1. Run the canonical guarded full snapshot packager for a clean PR head.
2. Inspect the ZIP member names before upload.
3. Observe image extensions under app assets and test fixtures despite the binary exclusion list.

## Context

A source-only backend review does not need these assets. The current exclusions make it easy to violate a caller's explicit no-image review constraint.
