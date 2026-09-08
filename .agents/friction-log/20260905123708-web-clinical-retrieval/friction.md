---
title: 'Web clinical retrieval test requires unbuilt vault-usecases declarations'
severity: 'minor'
issue: 'cobuildwithus/murph#2955'
---

## Expected Behavior

A clean Web production build and its focused clinical retrieval test resolve declared public workspace imports without unrelated package build artifacts.

## Current Behavior

The clinical retrieval test imports the public vault-usecases clinical-records entrypoint, but Web overrides the root TypeScript paths without mapping this entrypoint. Its shared Vitest source resolver also omits the entrypoint. A production build fails with TS2307 unless vault-usecases declaration output already exists.

## Minimal Reproducible Example

In a fresh checkout, install the frozen lockfile, prepare the Web generated prerequisites, and run `pnpm --dir apps/web typecheck:prepared` without building vault-usecases. The clinical retrieval test cannot resolve its public import.

## Context

The missing source mappings allow cached or broad workspace builds to hide a clean Web build failure. The task adds only the required public entrypoint to the existing Web TypeScript and shared test resolver configurations.
