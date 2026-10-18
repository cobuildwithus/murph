---
title: 'ReviewGPT exact artifact download can report an unrelated image as success'
severity: 'minor'
---

## Expected Behavior

The pinned ReviewGPT thread downloader should return the assistant attachment selected by exact capture metadata and artifact index, or fail when that file is unavailable.

## Current Behavior

An exact-metadata download for a completed assistant patch returned an image named avatar.png with exit status zero. Exporting the same accepted turn confirmed one patch attachment. Repeating the same exact-metadata and artifact-index download retrieved the expected patch. The caller had to validate the returned filename and content before application.

## Minimal Reproducible Example

After a waited authoring response with one synthetic patch attachment, run `pnpm exec cobuild-review-gpt thread download` with the original capture metadata, chat URL, artifact index zero and an empty output directory. Verify that the returned file is the selected patch rather than another page download. The observed first result was an unrelated image; the exact retry succeeded without a new model request.

## Context

This affects the repository's required ReviewGPT authoring workflow. Exact-turn metadata protected request identity, but the successful download result did not prove file identity. A synthetic regression around unrelated concurrent download events would help prevent a false-success result. No private conversation content or production evidence is needed.
