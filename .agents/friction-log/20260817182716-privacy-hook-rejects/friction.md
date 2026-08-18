---
title: 'Privacy hook rejects synthetic Git fixture identity'
severity: 'minor'
---

## Expected Behavior

Repo-tools tests can create synthetic Git repositories using a neutral test-only identity that satisfies the repository privacy guard.

## Current Behavior

Multiple Frog autofix tests fail during synthetic Git commits because the fixture email uses a non-noreply example address that the privacy hook rejects.

## Possible Solution

Use a neutral GitHub noreply-form fixture address for synthetic repositories.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/frog-autofix.test.ts` in a clean worktree.

## Context

This blocks the repo-internal fast-path verification for unrelated workflow prompt changes after all static guards and typechecking pass.
