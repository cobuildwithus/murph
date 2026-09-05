---
title: 'ReviewGPT snapshot listing exceeds the default spawnSync buffer on large repositories'
severity: 'minor'
issue: 'cobuildwithus/murph#2799'
---

## Expected Behavior

`pnpm review:gpt pr-review` packages the guarded repository snapshot, lists the ZIP entries for the sensitive-path and repomix manifest checks, and continues to the browser upload regardless of how many files the snapshot contains.

## Current Behavior

After `ReviewGPT PR attachment preflight passed`, the run fails with `code: UNKNOWN` and a `message` that is a truncated listing of repository paths, about one megabyte long. The audit ZIP is written but never uploaded. The listing step in `@cobuild/review-gpt` (`listAllZipEntries` and `listZipManifestPaths` in `review-gpt-lib`) calls `spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })` without `maxBuffer`, so Node's default one-megabyte limit kills `unzip` once the snapshot manifest passes that size and the partial stdout is thrown as the error.

## Possible Solution

Pass a generous `maxBuffer` (for example 64 MiB) to both `unzip -Z1` calls upstream, or stream the listing instead of buffering it. Until the upstream release, extend the repository's `@cobuild/review-gpt` pnpm patch with the same two-line change so `pnpm install --frozen-lockfile` reproduces the fix.

## Minimal Reproducible Example

1. Create a repository whose tracked file paths total more than 1,048,576 bytes when listed one per line (for example 20,000 files with 60-character paths).
2. Run `pnpm review:gpt pr-review` for any PR on that repository with a lane and round metadata that pass preflight.
3. Observe `code: UNKNOWN` followed by a truncated path listing as the message, with no browser upload.

## Context

Hit while running the substantive review round for the public goal guides PR after merging current `main`; the merged tree's snapshot manifest crossed the one-megabyte line. The round was unblocked by adding `maxBuffer` to the installed package locally, which is not reproducible for the next agent without the patch update. Every future round on this repository will hit the same limit until the tool or patch changes.
