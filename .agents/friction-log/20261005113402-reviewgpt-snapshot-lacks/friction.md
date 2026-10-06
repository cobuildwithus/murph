---
title: 'ReviewGPT snapshot lacks native Codex source for codex-public-live.patch changes'
severity: 'minor'
---

## Expected Behavior

A final ReviewGPT round for a PR that changes `patches/codex-public-live.patch` can inspect the complete patched native modules and their directly used owners at the pinned upstream revision.

## Current Behavior

The guarded snapshot includes the patch file but only its hunks. A reviewer returned INVALID because the surrounding native transport implementation and recovery owners were absent, even though the patch applied cleanly.

## Possible Solution

Have the packager apply the patch to the pinned upstream tag (as `verify:codex-upstream-source` already does) and include the touched native files plus a bounded owner list, similar to the dependency-context expansion.

## Minimal Reproducible Example

Change one function body inside a large native Codex module through the patch, run round 1 `pnpm review:gpt pr-review`, and observe that the archive contains only the hunk context.

## Context

Worked around by appending verbatim patched source through `--prompt-file` on a same-head retry. Affects any review of native Codex patch changes.
