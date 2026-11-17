---
title: 'A new package entrypoint passes every local check and fails CI until its source path map is added'
severity: 'minor'
---

## Expected Behavior

Adding a public entrypoint to a workspace package's `exports` either works in every lane, or a fast local check names the missing registration.

## Current Behavior

The entrypoint must also be listed in `tsconfig.base.json` paths, in `apps/web/tsconfig.json` paths, and in `scripts/workspace-source-resolution.test.ts`. Nothing local reports a missing path entry once the workspace has been built, because resolution falls back to the package's `dist`. Focused tests, seven typechecks, the workspace-boundary guard and the package-cycle guard all passed. CI lanes that run from source without a build (the runner bundle assembly under `tsx`, and Vitest lanes for unbuilt packages) then failed with `ERR_MODULE_NOT_FOUND` for the `dist` file.

## Possible Solution

Have the workspace-boundary guard compare every `exports` subpath of a workspace package with the base path map and fail on a missing entry.

## Minimal Reproducible Example

1. Add `src/example.ts` to a workspace package and an `./example` entry to its `exports`.
2. Import `@murphai/<package>/example` from another package's source.
3. Run `pnpm build:workspace:incremental`, the focused tests and the typechecks: all pass.
4. Delete the package's `dist/example.js` and run a `tsx` script that imports the consumer: it fails to resolve the module.

## Context

Found while adding one small shared constant module. It cost a failed required CI run on a ready pull request, plus the diagnosis.
