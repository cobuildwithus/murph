---
title: 'Documented changelog test command misses repository-root discovery and generated input'
severity: 'minor'
---

## Expected Behavior

The focused command documented in the changelog README and authoring skill should load and test authored fragments in a fresh installed worktree.

## Current Behavior

Running Vitest from apps/web finds no tests because the config includes repository-relative paths. Running the same config from the repository root then fails if the generated changelog module has not been prepared.

## Possible Solution

Document a focused command through the existing prepared test entrypoint or explicitly generate changelog fragments before invoking Vitest from the repository root.

## Minimal Reproducible Example

In a fresh installed worktree, run `pnpm --dir apps/web exec vitest run --config vitest.config.ts --no-coverage test/changelog-page.test.tsx`. Then run `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx` before changelog generation.

## Context

Both commands block the documented content-only changelog verification. Existing test-filter separator friction covers a different argument parsing failure.
