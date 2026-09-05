---
title: 'Web typecheck omits the vault-usecases clinical-records build prerequisite'
severity: 'minor'
---

## Expected Behavior

The declared hosted Web typecheck command prepares the workspace artifacts needed by its source and test imports in a fresh checkout.

## Current Behavior

After a frozen install and Prisma generation, Web typecheck fails with TS2307 for the public @murphai/vault-usecases/clinical-records entrypoint. That entrypoint resolves to dist declarations that the Web typecheck preparation does not build.

## Minimal Reproducible Example

In a fresh task checkout, run pnpm install --frozen-lockfile, then pnpm --dir apps/web typecheck. The clinical-records import cannot resolve. Running pnpm --filter @murphai/vault-usecases... build prepares the missing declaration graph.

## Context

A focused auth diagnostics change required an unrelated workspace build before the relevant Web typecheck could run.
