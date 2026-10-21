---
title: 'Built contract artifacts mask missing hosted Web source entrypoint mappings'
severity: 'minor'
---

## Expected Behavior

A focused hosted Web typecheck should catch a missing public workspace subpath mapping before the clean CI Web build.

## Current Behavior

Hosted Web overrides the base TypeScript paths map. Adding public contract entrypoints and root source paths does not add those paths to the Web override. A local contracts build supplies dist declarations, so the Web typecheck passes locally but clean CI reports TS2307 for the same imports.

## Possible Solution

Validate that Web's explicit source mapping covers consumed public workspace exports, or provide a focused source-only check that cannot resolve built workspace artifacts. Keep ordinary package entrypoints authoritative rather than adding a separate runtime resolver.

## Minimal Reproducible Example

1. Add a public leaf export to a workspace package and root TypeScript paths, then consume it through an existing Web dependency.
2. Build that package and run the Web typecheck: it can pass without the Web-specific source mapping.
3. Move the locally generated package dist directory aside and run `node scripts/run-typescript.mjs web -p apps/web/tsconfig.json --pretty false --incremental false`: the missing subpath fails with TS2307.
4. Add the corresponding path to Web's existing map: the same source-only typecheck passes.

## Context

Observed while narrowing hosted startup schema dependencies. The task fixes the two missing Web mappings; this entry records the verification gap without changing the workspace resolution architecture.
