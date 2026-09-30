---
title: 'Fresh Web typecheck needs an unprepared clinical-records importer entrypoint'
severity: 'minor'
---

## Expected Behavior

The documented Web typecheck command prepares its generated dependencies in a fresh checkout.

## Current Behavior

After a frozen install, `pnpm --dir apps/web typecheck` fails with TS2307 for `@murphai/importers/clinical-records`, imported by `packages/vault-usecases/src/clinical-document-storage.ts`. The package exports generated declarations that the Web preparation does not build.

## Minimal Reproducible Example

1. Create a clean task checkout and run `pnpm install --frozen-lockfile`.
2. Run `pnpm --dir apps/web typecheck` before building workspace packages.
3. Observe the unresolved public importer subpath.
4. Run `pnpm --dir packages/importers build` to prepare that entrypoint.

## Context

Focused Web verification requires an additional dependency-preparation step. No production data or environment credentials are needed to reproduce it.
