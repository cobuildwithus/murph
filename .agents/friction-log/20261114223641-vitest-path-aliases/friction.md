---
title: 'Vitest path aliases can shadow exact entries with an earlier wildcard'
severity: 'minor'
issue: 'cobuildwithus/murph#4987'
---

## Expected Behavior

An exact workspace TypeScript path should take precedence over a matching wildcard in source test lanes, matching TypeScript resolution.

## Current Behavior

createVitestAliasesFromTsconfigPaths preserves JSON insertion order. Adding an exact operator-config subpath after the existing wildcard passes Web source resolution and typechecks, but CLI source tests resolve it through the wildcard to a nonexistent source file. Built CLI probes still pass.

## Possible Solution

Order exact aliases before wildcard aliases and exercise a synthetic overlapping mapping in the source-resolution tests. Until then, place exact path entries before overlapping wildcard entries.

## Minimal Reproducible Example

Add an exact mapping for @murphai/operator-config/vault-selection to packages/operator-config/src/operator-config/storage.ts after @murphai/operator-config/*. Register the package export and Web mapping, then run the CLI entrypoint tests through the source Vitest configuration.

## Context

Scoped CLI startup optimization exposed a mismatch between successful package resolution and failing source test resolution. Reordering the exact mapping restores the existing source lane.
