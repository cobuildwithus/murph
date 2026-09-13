---
title: 'Changelog focused-test command runs Vitest from the wrong directory'
severity: 'minor'
---

## Expected Behavior

The focused command in apps/web/changelog/README.md should run the changelog archive tests.

## Current Behavior

The documented app-directory invocation exits with no test files found. The Vitest project includes repository-relative apps/web/test paths but does not set a repository root.

## Minimal Reproducible Example

Run `pnpm --dir apps/web exec vitest run --config vitest.config.ts --no-coverage test/changelog-page.test.tsx` from the repository root. Vitest searches for apps/web/test beneath the app directory and discovers no files.

## Possible Solution

Document the repository-root invocation: `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`.

## Context

Focused verification of a frontend fix required correcting the working directory before the documented changelog proof could execute.
