---
title: 'Hosted-local doctor misses required Temporal worker package'
severity: 'minor'
---

## Expected Behavior

`pnpm hosted-local worktree doctor <slug>` should fail when the selected worktree profile requires a Temporal worker package that is unavailable, or it should report the exact UI-only fallback before `up` is attempted.

## Current Behavior

The doctor reports every prerequisite as ready, but the immediately following `pnpm hosted-local worktree up <slug>` exits before serving because the profile resolves to managed Temporal and no external worker package directory is configured.

## Possible Solution

Have the doctor call the same Temporal worker-package validation as stack startup and report either the missing package input or the supported `MURPH_DEV_TEMPORAL=disabled` fallback.

## Minimal Reproducible Example

1. Use a secondary worktree without an external Temporal worker package.
2. Run `pnpm hosted-local worktree doctor <slug>` and observe all checks pass.
3. Run `pnpm hosted-local worktree up <slug>` and observe the missing-worker-package failure.

## Context

This adds a failed startup cycle to exact-head frontend proof. UI-only design-catalog verification can proceed by explicitly disabling Temporal.
